import {OBSIDIAN} from '../global.js';
import {ObsidianStandaloneDialog} from './standalone.js';
import {getSourceClass} from '../module/item.js';
import {ObsidianItems} from '../module/items.js';

export class ObsidianConsumeSlotDialog extends ObsidianStandaloneDialog {
	constructor (actor, options, min) {
		super({parent: options.parent, actor: actor});
		this._actor = actor;
		this._options = options;
		this._min = min;
		this._item = actor.items.get(options.id);
	}

	static get defaultOptions () {
		const options = super.defaultOptions;
		options.width = 125;
		options.title = game.i18n.localize('OBSIDIAN.CastAtWhichLevel');
		options.template = 'modules/obsidian/html/dialogs/consume-slot.html';
		return options;
	}

	/**
	 * @param {JQuery} html
	 * @return undefined
	 */
	activateListeners (html) {
		super.activateListeners(html);
		html.find('.rollable').click(this._onUse.bind(this));
	}

	getData () {
		const data = super.getData();
		data.min = this._min;
		data.ritual = false;
		data.pactAllowed =
			this._actor.system.spells.pact && this._actor.system.spells.pact.level >= data.min;

		if (this._item.type === 'spell' && this._item.getFlag('obsidian', 'source')) {
			const cls = getSourceClass(this._actor, this._item.getFlag('obsidian', 'source'));
			const ritualSpell = this._item.system.components.ritual;
			data.ritual = ritualSpell && cls && cls.getFlag('obsidian', 'spellcasting.rituals') !== 'none';
		}

		const parentComponent = this._item.getFlag('obsidian', 'parentComponent');
		const component = this._actor.obsidian?.components.get(parentComponent);

		if (component?.source === 'individual'
			&& component?.method === 'innate'
			&& component?.withSlot && component?.max)
		{
			data.freeCasts = {remaining: component.remaining, max: component.max};
		}

		return data;
	}

	/**
	 * @private
	 * @param {JQuery.TriggeredEvent} evt
	 */
	_onUse (evt) {
		const isRitual = evt.currentTarget.dataset.level === 'ritual';
		const isPact = evt.currentTarget.dataset.level === 'pact';
		const isFree = evt.currentTarget.dataset.level === 'free';
		let level = Number(evt.currentTarget.dataset.level);

		if (isPact) {
			level = this._actor.system.spells.pact.level;
		} else if (this._item.type === 'spell' && (isRitual || isFree)) {
			level = this._item.system.level;
		}

		if (!isRitual && !isFree) {
			const spellKey = isPact ? 'system.spells.pact' : `system.spells.spell${level}`;
			const spells = getProperty(this._actor, spellKey);

			// Maybe this should be moved out into the final resolution stage
			// where other resources are consumed.
			if ((spells.tmp || 0) > 0) {
				this._actor.update({[`${spellKey}.tmp`]: spells.tmp - 1});
			} else {
				this._actor.update({[`${spellKey}.value`]: Math.max(0, spells.value - 1)});
			}
		}

		if (isFree) {
			const parentComponent = this._item.getFlag('obsidian', 'parentComponent');
			const component = this._actor.obsidian.components.get(parentComponent);
			const effect = this._actor.obsidian.effects.get(component.parentEffect);
			const parentItem = this._actor.items.get(effect.parentItem);
			const updateKey =
				`flags.obsidian.effects.${effect.idx}.components.${component.idx}.remaining`;
			parentItem.update(
				OBSIDIAN.updateArrays(
					parentItem._source, {[updateKey]: Math.max(0, component.remaining - 1)}));
		}

		this._options.spellLevel = level;
		ObsidianItems.roll(this._actor, this._options);
		this.close();
	}
}
