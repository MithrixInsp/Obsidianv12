import {OBSIDIAN} from '../global.js';
import {ObsidianActor} from './actor.js';
import {Sheet} from './sheet.js';
import {ObsidianDialog} from '../dialogs/dialog.js';
import {deleteMessage, setMessageFlag} from './chat-log.js';

export const Reorder = {
	dragStart: function (event) {
		const target = event.target;
		if (target.dataset && target.dataset.reorderable === 'true') {
			event.dataTransfer.setData('item-id', target.dataset.itemId);
			if (target.tagName === 'SUMMARY') {
				event.dataTransfer.setData('source/container', null);
			}
		} else {
			event.dataTransfer.setData('macro-only', '');
		}
	},

	dragOver: function (event) {
		event.preventDefault();
		let src = event.dataTransfer.types.find(type => type.startsWith('source/'));
		if (src) {
			src = src.split('/')[1];
		}

		let [row, container, contents] = Reorder.detectElementBeneath(event);
		if (!contents) {
			return false;
		}

		contents = $(contents);
		contents.find('.obsidian-inv-container').removeClass('obsidian-container-drop');
		const indicator = contents.children('.obsidian-drag-indicator');

		if ((!src && row) || (src === 'container' && container)) {
			const rect = row ? row.getBoundingClientRect() : container.getBoundingClientRect();
			let top = rect.y;

			if (Reorder.whichHalf(event, rect) === 'bottom') {
				top += rect.height;
			}

			indicator.css({
				top: top - 8,
				left: rect.x - 8,
				display: 'flex',
				width: `${rect.width + 16}px`
			});
		} else {
			indicator.css('display', 'none');
			$(container).addClass('obsidian-container-drop');
		}

		return false;
	},

	drop: async function (actor, event) {
		event.preventDefault();
		if (event.dataTransfer.types.some(type => type === 'macro-only')) {
			return false;
		}

		if (event.dataTransfer.types.some(type => type === 'parcel-id')) {
			Reorder.openParcel(actor, event.dataTransfer.getData('parcel-id'));
			return false;
		}

		if (event.dataTransfer.types.some(type => type === 'currency-id')) {
			Reorder.transferCurrency(actor, event);
			return false;
		}

		let data;
		let srcID;
		const idData = event.dataTransfer.types.find(type => type === 'item-id');

		try {
			data = JSON.parse(event.dataTransfer.getData('text/plain'));
		} catch (ignored) {}

		if (idData) {
			srcID = event.dataTransfer.getData('item-id');
		} else if (data && data.id) {
			srcID = data.id;
		}

		let src;
		if (!srcID && !data) {
			return false;
		}

		if (data && data.data && data.actorId !== undefined && data.actorId !== actor.id) {
			// Transfer from another actor.
			Reorder.transfer(actor, data);
			return false;
		}

		if (data && !actor.items.get(srcID)) {
			const item = await Item.implementation.fromDropData(data);
			const dupe = ObsidianActor.duplicateItem(item);
			const created = await actor.createEmbeddedDocuments('Item', [dupe.toObject()]);
			src = created.shift();
		}

		const [row, container, contents] = Reorder.detectElementBeneath(event);
		if (!row && !container && !contents) {
			return false;
		}

		const target = row ? row : container;
		const half = Reorder.whichHalf(event, target);
		const where = half === 'bottom' ? 'after' : 'before';
		const destID = target?.dataset.itemId;
		const dest = actor.items.get(destID);
		const update = {};

		if (idData) {
			if (srcID === destID) {
				return false;
			} else {
				src = actor.items.get(srcID);
				if (!src) {
					return false;
				}
			}
		}

		if (!['weapon', 'equipment', 'consumable', 'backpack', 'tool', 'loot'].includes(src.type)) {
			return false;
		}

		Reorder.insert(actor, src, dest, where, update);
		actor.update(OBSIDIAN.updateArrays(actor._source, update), {diff: false});
		return false;
	},

	detectElementBeneath: function (event) {
		let row;
		let container;
		let contents;
		let current = event.target;

		while (current && current.nodeType !== Node.DOCUMENT_NODE) {
			if (current.nodeType !== Node.ELEMENT_NODE) {
				current = current.parentNode;
				continue;
			}

			if (current.classList.contains('obsidian-tr')) {
				row = current;
			} else if (current.classList.contains('obsidian-inv-container')) {
				container = current;
			} else if (current.classList.contains('obsidian-tab-contents')) {
				contents = current;
				break;
			}

			current = current.parentNode;
		}

		return [row, container, contents];
	},

	insert: function (actor, src, dest, where, update) {
		const root = actor.obsidian.inventory.root;
		const containers = actor.obsidian.inventory.containers;
		const destParent = actor.getItemParent(dest);
		let siblings = destParent == null ? root : destParent.obsidian.contents;

		if (src.type === 'backpack') {
			siblings = containers;
		} else if (dest?.type === 'backpack') {
			siblings = dest.obsidian.contents;
		}

		const existing = siblings.find(i => i.id === src.id) || src;
		const updates = SortingHelpers.performIntegerSort(existing, {
			target: siblings.find(i => i.id === dest?.id),
			siblings: siblings,
			sortBefore: where === 'before'
		});

		updates.forEach(u => update[`items.${u.target.idx}.sort`] = u.update.sort);

		const parentKey = `items.${src.idx}.flags.obsidian.parent`;
		update[parentKey] = destParent?.id || null;

		if (src.type !== 'backpack' && dest?.type === 'backpack') {
			// Moving an item into a backpack.
			update[parentKey] = dest.id;
		}
	},

	openParcel: async function (actor, id) {
		const msg = game.messages.get(id);
		if (!msg) {
			return;
		}

		const payload = msg.getFlag('obsidian', 'payload');
		const amount = msg.getFlag('obsidian', 'amount');

		if (!payload || !amount) {
			return;
		}

		const doOpen = qty => {
			const remaining = Math.clamped(amount - qty, 0, amount);
			if (remaining === 0) {
				deleteMessage(msg);
			} else {
				setMessageFlag(msg, 'amount', remaining);
			}

			const similarItem = actor.items.find(i => i.name === payload.name);
			if (similarItem) {
				actor.updateEmbeddedDocuments('Item', [{
					_id: similarItem.id,
					'system.quantity': (similarItem.system.quantity || 0) + qty
				}]);
			} else {
				const createData = mergeObject(payload, {'system.quantity': qty}, {inplace: false});
				delete createData._id;
				actor.createEmbeddedDocuments('Item', [createData]);
			}
		};

		if (amount < 2) {
			doOpen(1);
		} else {
			const content = await renderTemplate('modules/obsidian/html/dialogs/transfer.html', {
				max: amount,
				name: payload.name
			});

			new Dialog({
				content,
				title: game.i18n.localize('OBSIDIAN.Transfer'),
				default: 'transfer',
				buttons: {
					transfer: {
						icon: '<i class="fas fa-share"></i>',
						label: game.i18n.localize('OBSIDIAN.Transfer'),
						callback: dlg => doOpen(Number(dlg.querySelector('input').value))
					},
					takeAll: {
						icon: '<i class="fa-solid fa-share-all"></i>',
						label: game.i18n.localize('OBSIDIAN.TakeAll'),
						callback: () => doOpen(amount)
					}
				},
				render: html => ObsidianDialog.initialiseComponents($(html))
			}, {
				jQuery: false,
				width: 300,
				classes: ['form', 'dialog', 'obsidian-window']
			}).render(true);
		}
	},

	transferCurrency: async function (actor, evt) {
		const id = evt.dataTransfer.getData('currency-id');
		const msg = game.messages.get(id);

		if (!msg) {
			return;
		}

		const payload = msg.getFlag('obsidian', 'payload');
		if (!payload) {
			return;
		}

		const [, container] = Reorder.detectElementBeneath(evt);
		const dest = actor.items.get(container?.dataset.itemId);

		const doTransfer = (dlg, {all=false}={}) => {
			const {transfer, remaining} = Sheet.sumCurrency(dlg, payload);

			if (all) {
				Object.entries(payload).forEach(([denom, amount]) => {
					transfer[denom] = amount;
					remaining[denom] = 0;
				});
			}

			if (Object.values(remaining).reduce((acc, n) => acc + n) <= 0) {
				deleteMessage(msg);
			} else {
				setMessageFlag(msg, 'payload', remaining);
			}

			actor.receiveCurrency(transfer, dest?.id);
		};

		const content =
			await renderTemplate('modules/obsidian/html/dialogs/transfer-currency.html', {
				currency: payload
			});

		new Dialog({
			content,
			title: game.i18n.localize('OBSIDIAN.TransferCurrency'),
			default: 'transfer',
			buttons: {
				transfer: {
					icon: '<i class="fas fa-share"></i>',
					label: game.i18n.localize('OBSIDIAN.Transfer'),
					callback: dlg => doTransfer(dlg)
				},
				takeAll: {
					icon: '<i class="fa-solid fa-share-all"></i>',
					label: game.i18n.localize('OBSIDIAN.TakeAll'),
					callback: dlg => doTransfer(dlg, {all: true})
				}
			}
		}, {
			jQuery: false,
			width: 300,
			classes: ['form', 'dialog', 'obsidian-window']
		}).render(true);
	},

	transfer: async function (actor, transfer) {
		const doTransfer = qty => {
			let remaining = transfer.data.system.quantity - qty;
			if (remaining < 0) {
				remaining = 0;
			}

			const otherActor = game.actors.get(transfer.actorId);
			if (!otherActor) {
				return;
			}

			if (remaining === 0) {
				otherActor.deleteEmbeddedDocuments('Item', [transfer.data._id]);
			} else {
				otherActor.updateEmbeddedDocuments('Item', [{
					_id: transfer.data._id,
					'system.quantity': remaining
				}]);
			}

			transfer.data.system.quantity = qty;
			if (getProperty(transfer.data, 'flags.obsidian.parent')) {
				delete transfer.data.flags.obsidian.parent;
			}

			const item = ObsidianActor.duplicateItem(transfer.data);
			if (actor.isOwner) {
				actor.createEmbeddedDocuments('Item', [item.toObject()]);
			} else {
				game.socket.emit('module.obsidian', {
					action: 'CREATE',
					entity: 'Item',
					uuid: actor.uuid,
					data: item.toObject()
				});
			}
		};

		if (transfer.data.system.quantity < 2) {
			doTransfer(1);
		} else {
			const dlg = await renderTemplate('modules/obsidian/html/dialogs/transfer.html', {
				max: transfer.data.system.quantity,
				name: transfer.data.name
			});

			new Dialog({
				title: game.i18n.localize('OBSIDIAN.Transfer'),
				content: dlg,
				default: 'transfer',
				buttons: {
					transfer: {
						icon: '<i class="fas fa-share"></i>',
						label: game.i18n.localize('OBSIDIAN.Transfer'),
						callback: dlg => doTransfer(Number(dlg.find('input').val()))
					}
				},
				render: html => ObsidianDialog.initialiseComponents(html)
			}, {classes: ['form', 'dialog', 'obsidian-window'], width: 300}).render(true);
		}
	},

	whichHalf: function (event, target) {
		if (!target) {
			return '';
		}

		if (!(target instanceof DOMRect)) {
			target = target.getBoundingClientRect();
		}

		return event.y > target.y + target.height / 2 ? 'bottom' : 'top';
	}
};
