import {ObsidianDialog} from '../dialogs/dialog.js';
import {ObsidianActor} from './actor.js';
import {Sheet} from './sheet.js';
import ObsidianAwardDialog from '../dialogs/award.js';

Hooks.on('getChatLogEntryContext', onMessageContext);

export function addChatLogDropHandlers () {
	const chatLog = document.getElementById('chat-log');
	const dropHint = document.createElement('div');
	dropHint.classList.add('obsidian-drop-hint');
	dropHint.textContent = game.i18n.localize('OBSIDIAN.ChatLogDropHint');
	chatLog.appendChild(dropHint);
	chatLog.addEventListener('drop', onChatLogDrop);
	chatLog.addEventListener('dragover', onChatLogDragover);
	chatLog.addEventListener('dragleave', onChatLogDragleave);
	addAwardCommand();
}

function addAwardCommand () {
	const patterns = ChatLog.MESSAGE_PATTERNS;
	const invalid = patterns.invalid;
	delete patterns.invalid;

	ChatLog.MESSAGE_PATTERNS = {
		...patterns,
		award: /^(\/award )(.*?)$/i,
		invalid
	};

	Hooks.on('chatMessage', onChatMessage);
}

function onChatMessage (log, message) {
	const [command, match] = log.constructor.parse(message);
	if (command !== 'award') {
		return;
	}

	let [,, award] = match;
	award = award.replace(/\s+/g, '');

	const currency = award.split(',').reduce((acc, part) => {
		const [, amount, denom] = part.match(/(\d+)(\D+)/) ?? [];
		if (!Number.isNumeric(amount) || Number(amount) < 0 || !CONFIG.DND5E.currencies[denom]) {
			return acc;
		}

		acc[denom] = (acc[denom] ?? 0) + Number(amount);
		return acc;
	}, {});

	const [, xp] = award.replace(/[,.]/g, '').match(/(\d+)xp/i) ?? [];
	const flags = {};

	if (Number.isNumeric(xp)) {
		flags.xp = true;
		flags.payload = Number(xp);
	}

	if (!isEmpty(currency)) {
		flags.currency = true;
		flags.payload = currency;
	}

	if (!isEmpty(flags)) {
		ChatMessage.implementation.create({
			speaker: ChatMessage.implementation.getSpeaker(),
			user: game.userId,
			rollMode: CONST.DICE_ROLL_MODES.PUBLIC,
			content: 'N/A',
			flags: {obsidian: flags}
		});
	}

	return false;
}

async function onChatLogDrop (evt) {
	evt.currentTarget.classList.remove('obsidian-dragover');
	const dragData = TextEditor.getDragEventData(evt);
	console.log(dragData);

	if (dragData.type === 'obsidian-currency') {
		return showCurrencyTransferDialog(dragData);
	}

	if (dragData.type !== 'Item') {
		return;
	}

	const item = await Item.implementation.fromDropData(dragData);
	if (!item) {
		return;
	}

	return showParcelCreateDialog(item, game.actors.get(dragData.actorId));
}

function onChatLogDragover (evt) {
	if (!evt.dataTransfer.types.some(type => ['item-id', 'currency-drop'].includes(type))) {
		return;
	}

	evt.preventDefault();
	evt.currentTarget.classList.add('obsidian-dragover');
}

function onChatLogDragleave (evt) {
	evt.currentTarget.classList.remove('obsidian-dragover');
}

function onMessageContext (log, items) {
	items.push({
		name: 'OBSIDIAN.SplitAward',
		icon: '<i class="fas fa-exchange-alt"></i>',
		condition (li) {
			if (!game.user.isGM) {
				return false;
			}
			const message = game.messages.get(li.data('messageId'));
			return message.getFlag('obsidian', 'currency') || message.getFlag('obsidian', 'xp');
		},
		callback (li) {
			const message = game.messages.get(li.data('messageId'));
			new ObsidianAwardDialog(allocation => onSplitAward(message, allocation), {
				remainder: message.getFlag('obsidian', 'currency')
			}).render(true);
		}
	});
}

function onSplitAward (message, {remainder, actors}) {
	if (message.getFlag('obsidian', 'currency')) {
		return onSplitCurrency(message, {remainder, actors});
	} else if (message.getFlag('obsidian', 'xp')) {
		return onSplitXP(message, {remainder, actors});
	}
}

async function onSplitCurrency (message, {remainder, actors}) {
	const currency = message.getFlag('obsidian', 'payload');
	const remaining = {};
	const share = {};

	for (const [denom, amount] of Object.entries(currency)) {
		const per = Math.floor(amount / actors.length);
		if (per > 0) {
			share[denom] = per;
			remaining[denom] = amount % actors.length;
		} else {
			remaining[denom] = amount;
		}
	}

	if (remainder === 'none' && !isEmpty(remaining)) {
		message.setFlag('obsidian', 'payload', remaining);
	} else if (remainder === 'random' || isEmpty(remaining)) {
		message.delete();
	}

	let extra;
	if (remainder === 'random' && !isEmpty(remaining)) {
		const die = new Die({faces: actors.length});
		extra = actors[die.roll().result - 1];
	}

	if (!isEmpty(share)) {
		for (const id of actors) {
			const actor = game.actors.get(id);
			if (!actor) {
				continue;
			}

			const currency = {...share};
			if (extra === id) {
				Object.entries(remaining).forEach(([denom, amount]) => currency[denom] += amount);
			}

			await actor.receiveCurrency(currency);
		}
	}
}

async function onSplitXP (message, {actors}) {
	const xp = message.getFlag('obsidian', 'payload');
	const share = Math.floor(xp / actors.length);
	message.delete();

	if (share < 1) {
		return;
	}

	for (const id of actors) {
		const actor = game.actors.get(id);
		if (!actor) {
			continue;
		}

		const current = actor.system.details?.xp?.value ?? 0;
		await actor.update({'system.details.xp.value': current + share});
	}
}

async function showCurrencyTransferDialog (dragData) {
	const actor = await fromUuid(dragData.uuid);
	if (!actor) {
		return;
	}

	const src = actor.items.get(dragData.containerId);
	const available = src?.getFlag('obsidian', 'currency') ?? actor.system.currency;
	const users = Array.from(game.users);
	const currency = Object.fromEntries(Object.entries(available).map(([k, v]) => [k, v ?? 0]));
	const content = await renderTemplate('modules/obsidian/html/dialogs/transfer-currency.html', {
		currency,
		users: {
			users: Object.fromEntries(users.map(u => [u.id, u.name])),
			selected: Object.fromEntries(users.map(u => [u.id, true]))
		}
	});

	new Dialog({
		content,
		title: game.i18n.localize('OBSIDIAN.TransferCurrency'),
		default: 'transfer',
		buttons: {
			transfer: {
				icon: '<i class="fas fa-share"></i>',
				label: game.i18n.localize('OBSIDIAN.Transfer'),
				callback: dlg => onTransferCurrency(dlg, actor, src)
			},
			takeAll: {
				icon: '<i class="fa-solid fa-share-all"></i>',
				label: game.i18n.localize('OBSIDIAN.TransferAll'),
				callback: dlg => onTransferCurrency(dlg, actor, src, {all: true})
			}
		},
		render: html => ObsidianDialog.initialiseComponents($(html))
	}, {
		jQuery: false,
		width: 300,
		classes: ['form', 'dialog', 'obsidian-window']
	}).render(true);
}

async function showParcelCreateDialog (item, actor) {
	const users = Array.from(game.users);
	const content = await renderTemplate('modules/obsidian/html/dialogs/parcel-create.html', {
		item, actor,
		users: {
			users: Object.fromEntries(users.map(u => [u.id, u.name])),
			selected: Object.fromEntries(users.map(u => [u.id, true]))
		}
	});

	new Dialog({
		content,
		title: game.i18n.format('OBSIDIAN.CreateParcel', {name: item.name}),
		default: 'create',
		buttons: {
			create: {
				icon: '<i class="fa-solid fa-treasure-chest"></i>',
				label: game.i18n.localize('OBSIDIAN.Create'),
				callback: dlg => onCreateParcel(item, dlg, actor)
			}
		},
		render: html => ObsidianDialog.initialiseComponents($(html))
	}, {
		jQuery: false,
		width: 400,
		height: 200,
		classes: ['form', 'dialog', 'obsidian-window']
	}).render(true);
}

async function onCreateParcel (item, dlg, actor) {
	const form = dlg.querySelector('form');
	const amount = Number(form.elements.amount.value);

	if (!amount) {
		return;
	}
	const operation = form.elements.operation?.value ?? 'copy';
	const chatData = {
		speaker: ChatMessage.implementation.getSpeaker({actor}),
		user: game.user.id,
		rollMode: CONST.DICE_ROLL_MODES.PUBLIC,
		content: 'N/A',
		flags: {
			obsidian: {
				amount,
				parcel: true,
				payload: getParcelData(item, actor)
			}
		}
	};

	if (item.img !== foundry.documents.BaseItem.DEFAULT_ICON) {
		chatData.flags.obsidian.icon = item.img;
	}

	const whisper = getWhisperFromAvailability(form);
	if (whisper) {
		chatData.whisper = whisper;
	}

	if (operation === 'transfer' && actor) {
		const original = actor.items.get(item._id);
		if (original) {
			const remaining = original.system.quantity - amount;
			if (remaining <= 0) {
				await actor.deleteEmbeddedDocuments('Item', [item._id]);
			} else {
				await actor.updateEmbeddedDocuments('Item', [{
					_id: item._id,
					'system.quantity': remaining
				}]);
			}
		}
	}

	return ChatMessage.implementation.create(chatData);
}

function onTransferCurrency (dlg, actor, src, {all=false}={}) {
	const available = src?.getFlag('obsidian', 'currency') ?? actor.system.currency;
	const {transfer, remaining} = Sheet.sumCurrency(dlg, available);

	if (all) {
		Object.entries(available).forEach(([denom, amount]) => {
			transfer[denom] = amount;
			remaining[denom] = 0;
		});
	}

	if (src) {
		src.setFlag('obsidian', 'currency', remaining);
	} else {
		actor.update({'system.currency': remaining});
	}

	const chatData = {
		speaker: ChatMessage.implementation.getSpeaker({actor}),
		user: game.user.id,
		rollMode: CONST.DICE_ROLL_MODES.PUBLIC,
		content: 'N/A',
		flags: {
			obsidian: {
				currency: true,
				payload: transfer
			}
		}
	};

	const whisper = getWhisperFromAvailability(dlg.querySelector('form'));
	if (whisper) {
		chatData.whisper = whisper;
	}

	return ChatMessage.implementation.create(chatData);
}

export function getParcelData (item, actor) {
	const dupe = ObsidianActor.duplicateItem(item.toObject()).toObject();
	const effects = dupe.flags?.obsidian?.effects;

	if (!actor || !effects?.length) {
		return dupe;
	}

	for (const effect of effects) {
		for (const component of effect.components.filter(c => c.type === 'spells')) {
			component.spells =
				component.spells
					.filter(id => typeof id === 'string')
					.map(id => actor.items.get(id))
					.filter(_ => _)
					.map(spell => {
						const data = spell.toObject();
						delete data._id;
						return ObsidianActor.duplicateItem(data).toObject();
					});
		}
	}

	return dupe;
}

function getWhisperFromAvailability (form) {
	const availability = form.elements.availability.value;
	if (availability === 'some') {
		let allUsers = true;
		const whisper = [];

		Object.keys(form.elements).filter(k => k.startsWith('users.')).forEach(k => {
			const checked = form.elements[k].checked;
			if (checked) {
				whisper.push(k.split('.')[1]);
			} else {
				allUsers = false;
			}
		});

		if (!allUsers) {
			return whisper;
		}
	}

	return false;
}

export function deleteMessage (message) {
	if (game.user.isGM || message.isAuthor) {
		return message.delete();
	}

	return game.socket.emit('module.obsidian', {
		action: 'DELETE.MESSAGE',
		id: message.id
	});
}

export function setMessageFlag (message, key, value) {
	if (game.user.isGM || message.isAuthor) {
		return message.setFlag('obsidian', key, value);
	}

	return game.socket.emit('module.obsidian', {
		action: 'SET-FLAG.MESSAGE',
		id: message.id,
		key, value
	});
}
