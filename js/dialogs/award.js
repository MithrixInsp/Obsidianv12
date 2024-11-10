import {ObsidianStandaloneDialog} from './standalone.js';

export default class ObsidianAwardDialog extends ObsidianStandaloneDialog {
	constructor (cb, config={}) {
		super(config);
		this._cb = cb;
	}

	static get defaultOptions () {
		return mergeObject(super.defaultOptions, {
			width: 650,
			title: game.i18n.localize('OBSIDIAN.SplitAward'),
			template: 'modules/obsidian/html/dialogs/award.html'
		});
	}

	getData (options) {
		const data = super.getData(options);
		const primary = new Set(game.users.map(user => user.character).filter(_ => _));

		data.remainder = 'random';
		const actors = {};

		for (const actor of game.actors) {
			if (!['character', 'npc'].includes(actor.type)
				|| actor.name === OBSIDIAN.GENERIC_ACTOR)
			{
				continue;
			}

			actors[actor.id] = {
				name: actor.name,
				img: actor.img,
				selected: primary.has(actor),
				id: actor.id,
				type: actor.type
			};
		}

		const previous = {};
		const setting = game.settings.get('obsidian', 'awardAllocation');

		if (setting) {
			mergeObject(previous, JSON.parse(setting));
		}

		if (previous.actors) {
			mergeObject(actors, previous.actors);
		}

		if (previous.remainder) {
			data.remainder = previous.remainder;
		}

		data.actors = {
			primary: Array.from(primary).map(actor => {
				const entry = actors[actor.id];
				delete actors[actor.id];
				return entry;
			}),
			character: [],
			npc: []
		};

		for (const actor of Object.values(actors)) {
			data.actors[actor.type].push(actor);
		}

		Object.entries(data.actors).forEach(([k, v]) => {
			data.actors[k] = Object.values(v).sort(({name: a}, {name: b}) =>
				a.localeCompare(b, game.lang));
		});

		if (!this._config.remainder) {
			delete data.remainder;
		}

		return data;
	}

	activateListeners (html) {
		super.activateListeners(html);
		html.find('summary').click(() => setTimeout(() => this.setPosition({height: 'auto'}), 25));
		html.find('select').change(evt =>
			this._updatePrevious({remainder: evt.currentTarget.value}));
		html.find('.obsidian-actor-grid-item').click(this._onClickActor.bind(this));
		html.find('button').click(this._onSubmit.bind(this));
	}

	_onClickActor (evt) {
		const target = evt.currentTarget;
		const active = target.classList.contains('obsidian-actor-grid-item-active');
		target.classList.toggle('obsidian-actor-grid-item-active', !active);
		return this._updatePrevious({actors: {[target.dataset.actorId]: {selected: !active}}});
	}

	_onSubmit () {
		const remainder = this.element.find('select').val();
		const actors =
			Array.from(this.element.find('.obsidian-actor-grid-item-active'))
				.map(el => el.dataset.actorId);

		this._cb({remainder, actors});
		return this.close();
	}

	_updatePrevious (update) {
		const previous = {};
		const setting = game.settings.get('obsidian', 'awardAllocation');

		if (setting) {
			mergeObject(previous, JSON.parse(setting));
		}

		mergeObject(previous, update);
		return game.settings.set('obsidian', 'awardAllocation', JSON.stringify(previous));
	}
}
