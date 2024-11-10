import {ObsidianItemSheet} from './item-sheet.js';
import {OBSIDIAN} from '../global.js';

export class ObsidianClassSheet extends ObsidianItemSheet {
	static get defaultOptions () {
		const options = super.defaultOptions;
		options.template = 'modules/obsidian/html/sheets/class.html';
		return options;
	}

	get title () {
		return this.item.obsidian.label;
	}

	async close () {
		await super.close();
		Hooks.callAll('obsidian.classSheetClosed');
	}

	async getData () {
		const data = await super.getData();
		data.isCustom = !OBSIDIAN.Config.CLASSES.includes(this.item.identifier);
		data.identifier = this.item.identifier;
		data.subclass = this.item.subclass;

		if (this.item.isOwned) {
			data.rollData = this.item.actor.getRollData();
		}

		return data;
	}

	activateListeners (html) {
		super.activateListeners(html);
		html.find('[name="name"]').keyup(evt => {
			html.find('[name="data.identifier"]')
				.attr('placeholder', evt.currentTarget.value.slugify({strict: true}));
		});

		html.find('.obsidian-delete').click(async evt => {
			if (!evt.currentTarget.classList.contains('obsidian-alert')) {
				evt.currentTarget.classList.add('obsidian-alert');
				return;
			}

			const id = evt.currentTarget.closest('[data-item-id]').dataset.itemId;
			await this.item.actor.items.get(id)?.delete();
			this.render();
		});

		html.find('.obsidian-edit').click(evt => {
			const id = evt.currentTarget.closest('[data-item-id]').dataset.itemId;
			this.item.actor.items.get(id)?.sheet.render(true);
		});
	}
}
