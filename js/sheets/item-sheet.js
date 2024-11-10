import {OBSIDIAN} from '../global.js';
import {ObsidianDialog} from '../dialogs/dialog.js';

export class ObsidianItemSheet extends ItemSheet {
	constructor (...args) {
		super(...args);
		if (this.actor && this.actor.apps) {
			Object.values(this.actor.apps)
				.filter(app => app.setModal)
				.forEach(app => app.setModal(true));
		}

		this._numberFormatter = new Intl.NumberFormat();
	}

	static get defaultOptions () {
		const options = super.defaultOptions;
		options.width = 520;
		options.classes = options.classes.concat(['item', 'dialog', 'obsidian-window']);
		options.resizable = false;
		options.submitOnChange = false;
		options.scrollY = (options.scrollY || []).concat('.window-content');
		return options;
	}

	/**
	 * @param html {JQuery}
	 * @return undefined
	 */
	activateListeners (html) {
		super.activateListeners(html);
		console.debug(this.item);
		ObsidianDialog.initialiseComponents(html);

		html.find('input').focusout(this._delaySubmit.bind(this));
		html.find('select').change(this._onSubmit.bind(this));

		if (this.isEditable) {
			html.find('.obsidian-currency-selection [data-denomination]')
				.on('click', this._onChangeCurrencyDenomination.bind(this));
		}

		ObsidianDialog.prototype.activateLargeNumberInputs.call(this, html);
	}

	async getData () {
		const data = await super.getData();
		data.item = this.item.toObject(false);
		data.base = this.item.toObject();
		data.system = data.item.system;
		data.actor = this.actor;
		data.isNPC = this.actor?.type === 'npc';
		data.isCharacter = this.actor?.type === 'character';
		data.ObsidianConfig = OBSIDIAN.Config;
		data.ObsidianLabels = OBSIDIAN.Labels;

		if (data.actor) {
			data.actor.feats =
				data.actor.obsidian.itemsByType.get('feat').map(i => duplicate(i.toObject(false)));
		}

		return data;
	}

	async maximize () {
		await super.maximize();
		ObsidianDialog.recalculateHeight($(this.form));
	}

	async close () {
		await super.close();
		if (this.actor && this.actor.apps) {
			Object.values(this.actor.apps)
				.filter(app => app.setModal)
				.forEach(app => app.setModal(false));
		}
	}

	_onChangeCurrencyDenomination(event) {
		const target = event.currentTarget;
		const selector = target.closest('.obsidian-currency-selection');
		const currency = target.dataset.denomination;
		const currencies = OBSIDIAN.Config.CURRENCY;
		selector.classList.remove(...currencies.map(denom => `obsidian-icon-${denom}`));
		selector.classList.add(`obsidian-icon-${currency}`);
		selector.querySelector('[name="system.price.denomination"]').value = currency;
	}

	_delaySubmit (evt) {
		setTimeout(() => {
			if (!this.element.find('input:focus, select:focus').length) {
				this._onSubmit(evt);
			}
		}, 25);
	}

	activateEditor (name, options = {}, initialContent = '') {
		options.content_css = [
			...CONFIG.TinyMCE.content_css,
			OBSIDIAN.getFont(),
			'modules/obsidian/css/obsidian-mce.css'
		].join(',');
		super.activateEditor(name, options, initialContent);
	}

	formatLargeNumber (el) {
		ObsidianDialog.prototype.formatLargeNumber.call(this, el);
	}

	_getSubmitData (updateData={}) {
		const data = super._getSubmitData(updateData);
		// Re-add disabled fieldset checkboxes.
		this.form.querySelectorAll('fieldset[disabled] > legend > input[type=checkbox]').forEach(el => {
			data[el.name] = el.checked;
		});
		return data;
	}

	/**
	 * @private
	 */
	async _updateObject (event, formData) {
		ObsidianDialog.prototype.updateLargeNumberInputs.call(this, formData);
		return super._updateObject(event, OBSIDIAN.updateArrays(this.item._source, formData));
	}
}
