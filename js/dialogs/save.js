import {ObsidianDialog} from './dialog.js';

export class ObsidianSaveDialog extends ObsidianDialog {
	constructor (parent, saveID) {
		super(parent, {
			title: `${game.i18n.localize('OBSIDIAN.ManageSave')}: `
				+ game.i18n.localize(`OBSIDIAN.Ability.${saveID}`),
			width: 250
		});

		this.saveID = saveID;
	}

	get template () {
		return 'modules/obsidian/html/dialogs/save.html';
	}

	async getData () {
		const data = await super.getData();
		data.saveID = this.saveID;
		data.save = this.parent.actor.flags.obsidian.saves[this.saveID];
		return data;
	}
}
