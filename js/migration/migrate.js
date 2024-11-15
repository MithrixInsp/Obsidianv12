import {Schema} from '../data/schema.js';
import {ObsidianHeaderDetailsDialog} from '../dialogs/char-header.js';
import {OBSIDIAN} from '../global.js';
import {Effect} from '../module/effect.js';
import {Config} from '../data/config.js';
import {CONVERT} from './convert.js';
import {core} from './core.js';
import {v3} from './v3.js';
import {v4} from './v4.js';
import {v5} from './v5.js';
import {v6} from './v6.js';
import {v7} from './v7.js';
import {v9} from './v9.js';
import {v10} from './v10.js';
import {v11} from './v11.js';
import {v12} from './v12.js';
import {v13} from './v13.js';
import {v14} from './v14.js';
import {toSlug} from '../data.js';
import {v15} from './v15.js';

export const Migrate = {
	core, v3, v4, v5, v6, v7, v9, v10, v11, v12, v13, v14, v15,
	convertActor: function (data) {
		lazyConvert();

		if (!data.flags) {
			data.flags = {};
		}

		let source = 'obsidian';
		if (!data.flags.obsidian) {
			source = 'core';
		}

		data.flags.obsidian =
			mergeObject(Schema.Actor, data.flags.obsidian || {}, {inplace: false});

		if (data.flags.obsidian.version === undefined) {
			data.flags.obsidian.version = 0;
		}

		if (data.type === 'group') {
			return;
		}

		const version = data.flags.obsidian.version;
		if (source === 'core') {
			Migrate.core.convertAC(data);
			Migrate.core.convertDefenses(data);
		}

		if (version < 2) {
			Migrate.convertNotes(data, source);
			Migrate.convertProficiencies(data, source);
			Migrate.convertSpecial(data, source);
		}

		if (version < 5 && source !== 'core') {
			Migrate.v4.convertSpellcasting(data);
		}

		if (version < 6 && source !== 'core') {
			Migrate.v5.convertProficiencies(data);
		}

		if (version < 8 && source !== 'core') {
			Migrate.v7.convertActorDefenses(data);
		}

		if (version < 10 && source !== 'core') {
			Migrate.v9.convertTools(data);
		}

		if (version < 12 && source !== 'core') {
			Migrate.v11.convertSpeed(data);
		}

		if (version < 13 && source !== 'core') {
			Migrate.v12.convertSenses(data);
		}

		if (version < 14 && data.type === 'npc') {
			Migrate.v13.convertHD(data);
		}

		if (version < 15 && source !== 'core') {
			if (data.type === 'npc') {
				Migrate.v14.convertCreatureType(data);
			}

			Migrate.v14.convertSummon(data);
			Migrate.v14.convertTempMaxHP(data);
			Migrate.v14.convertSkills(data);
		}

		if (data.items?.length) {
			data.items = data.items.map(item => {
				const updated = Migrate.convertItem(item);
				if (data.type === 'npc' && (item.type === 'weapon' || item.flags.obsidian.armour)) {
					item.system.equipped = true;
				}

				return updated;
			});
		}

		if (source === 'core' && data.type === 'npc' && data.items && data.system) {
			Migrate.convertAC(data);
		}

		data.flags.obsidian.version = Schema.VERSION;
		return data;
	},

	convertItem: function (data) {
		if (!data.system) {
			data.system = {};
		}

		if (!data.flags) {
			data.flags = {};
		}

		let source = 'obsidian';
		if (!data.flags.obsidian) {
			data.flags.obsidian = {};
			source = 'core';
		}

		if (data.type === 'spell' && !data.flags.obsidian.components) {
			// This is an awkward case where we actually attach some flags to
			// spells when they come in via 'Manage Spells', so our usual
			// detection for whether an item is from core or is already
			// obsidian-enriched fails.
			source = 'core';
		}

		if (data.flags.ddbimporter && !data.flags.obsidian.version) {
			// This is a DDB imported item, so we still want to apply most core
			// conversions, but try to avoid clobbering any obsidian flags that
			// may have been pre-emptively set.
			source = 'core';
		}

		if (data.type === 'class') {
			Migrate.convertClass(data);
		} else if (data.type === 'consumable') {
			data.flags.obsidian =
				mergeObject(Schema.Consumable, data.flags.obsidian || {}, {inplace: false});
		} else if (data.type === 'backpack') {
			data.flags.obsidian =
				mergeObject(Schema.Container, data.flags.obsidian || {}, {inplace: false});
		} else if (data.type === 'equipment') {
			data.flags.obsidian =
				mergeObject(Schema.Equipment, data.flags.obsidian || {}, {inplace: false});
		} else if (data.type === 'feat') {
			data.flags.obsidian =
				mergeObject(Schema.Feature, data.flags.obsidian || {}, {inplace: false});
		} else if (data.type === 'spell') {
			data.flags.obsidian =
				mergeObject(Schema.Spell, data.flags.obsidian || {}, {inplace: false});
		} else if (data.type === 'weapon') {
			data.flags.obsidian =
				mergeObject(Schema.Weapon, data.flags.obsidian || {}, {inplace: false});
		} else if (data.type === 'tool') {
			data.flags.obsidian = {};
		}

		if (!data.flags.obsidian.effects) {
			data.flags.obsidian.effects = [];
		}

		if (data.flags.obsidian.version === undefined) {
			data.flags.obsidian.version = 0;
		}

		const version = data.flags.obsidian.version;
		if (source === 'core') {
			if (data.type === 'consumable') {
				Migrate.convertConsumable(data);
			} else if (data.type === 'equipment') {
				Migrate.convertEquipment(data);
			} else if (data.type === 'feat') {
				Migrate.convertFeature(data);
			} else if (data.type === 'spell') {
				Migrate.convertSpell(data);
			} else if (data.type === 'weapon') {
				Migrate.convertWeapon(data);
			}

			Migrate.core.convertActivation(data);
			Migrate.core.convertAttack(data);
		}

		if (data.type === 'feat' && source === 'core') {
			Migrate.core.convertClassFeature(data);
		}

		if (data.type === 'weapon' && version < 2 && !data.flags.obsidian.effects?.length) {
			data.flags.obsidian.effects = [Effect.create()];
			data.flags.obsidian.effects[0].components =
				[Effect.createComponent('attack'), Effect.createComponent('damage')];
			data.flags.obsidian.effects[0].components[0].proficient = true;
		}

		if (version < 2
			&& data.type === 'consumable'
			&& !data.flags.obsidian.unlimited
			&& (!data.flags.obsidian.effects
				|| !data.flags.obsidian.effects.length
				|| !data.flags.obsidian.effects.some(e =>
					e.components.some(c => c.type === 'consume' || c.type === 'resource'))))
		{
			if (!data.flags.obsidian.effects || !data.flags.obsidian.effects.length) {
				data.flags.obsidian.effects.push(Effect.create());
			}

			const component = Effect.createComponent('consume');
			component.target = 'qty';
			data.flags.obsidian.effects[0].components.push(component);
		}

		if (data.type === 'class' && version < 4 && source !== 'core') {
			Migrate.v3.convertHD(data);
		}

		if (data.type === 'feat' && version < 6 && source !== 'core') {
			Migrate.v5.convertActivation(data);
		}

		if (version < 7 && source !== 'core') {
			Migrate.v6.convertBonuses(data);
		}

		if (version < 8 && source !== 'core') {
			Migrate.v7.convertItemDefenses(data);
		}

		if (version < 10 && source !== 'core') {
			Migrate.v9.convertToolFilters(data);
		}

		if (version < 11 && source !== 'core') {
			Migrate.v10.convertAmmo(data);
			Migrate.v10.convertBonuses(data);
		}

		if (version < 15 && source !== 'core') {
			Migrate.v14.convertSpellcasting(data);
			Migrate.v14.convertActiveEffect(data);
		}

		if (version < 16 && source !== 'core') {
			Migrate.v15.convertClass(data);
		}

		data.flags.obsidian.version = Schema.VERSION;
		return data;
	},

	convertAC: function (data) {
		if (!data.items.some(item => item.flags?.obsidian?.armour)) {
			data.flags.obsidian.attributes.ac.override = data.system.attributes.ac.value?.toString();
		}
	},

	convertClass: function (data) {
		const identifier = data.system?.identifier || data.name.slugify({strict: true});
		if (!data.system.hitDice) {
			data.system.hitDice = ObsidianHeaderDetailsDialog.determineHD(identifier);
		}

		if (!data.flags.obsidian.spellcasting) {
			data.flags.obsidian.spellcasting =
				ObsidianHeaderDetailsDialog.determineSpellcasting(identifier);
		}

		if (!data.system.spellcasting) {
			data.system.spellcasting = {
				progression: OBSIDIAN.Config.CLASS_SPELL_PROGRESSION[identifier] || 'none',
				ability: OBSIDIAN.Config.CLASS_SPELL_MODS[identifier] || ''
			};
		}
	},

	convertConsumable: function (data) {
		data.flags.obsidian.subtype = CONVERT.consumable[data.system.consumableType];
	},

	convertEquipment: function (data) {
		if (!data.system.armor) {
			return;
		}

		if (data.system.armor.value) {
			data.flags.obsidian.armour = true;
			data.flags.obsidian.subtype = 'armour';
		}

		if (data.system.armor.dex !== 0 && data.system.armor.type !== 'shield') {
			data.flags.obsidian.addDex = true;
		}
	},

	convertFeature: function (data) {
		if (data.flags.obsidian.source?.type) {
			return;
		}

		data.flags.obsidian.source.type = 'other';
	},

	convertProficiencies: function (data, source) {
		if (!data.system?.traits) {
			return;
		}

		const traits = data.system.traits;
		if (traits.languages) {
			const custom = traits.languages.value?.indexOf('custom');
			if (custom != null && custom > -1) {
				traits.languages.value.splice(custom, 1);
			}

			if (!OBSIDIAN.notDefinedOrEmpty(traits.languages.custom)) {
				data.flags.obsidian.traits.profs.custom.langs =
					traits.languages.custom.split(/[,;] ?/g);
			}
		} else {
			traits.languages = {value: []};
		}

		if (source === 'core' && traits.toolProf) {
			const tools = data.flags.obsidian.tools;
			const [concrete, custom] = traits.toolProf.value.reduce(([concrete, custom], prof) => {
				const convert = CONVERT.tools[prof];
				if (convert) {
					concrete.push(convert);
				} else {
					custom.push(prof);
				}

				return [concrete, custom];
			}, [[], []]);

			concrete.forEach(prof => {
				if (tools[prof]) {
					tools[prof].enabled = true;
				} else {
					tools[prof] = {ability: 'str', bonus: 0, value: 1, enabled: true};
				}
			});

			custom.push(
				...traits.toolProf.custom.split(';')
					.map(prof => prof.trim())
					.filter(prof => prof.length));

			for (const tool of custom) {
				const id = toSlug(tool);
				tools[id] = {
					ability: 'str', bonus: 0, value: 1, custom: true, enabled: true,
					label: translateOrElseOriginal(`OBSIDIAN.ToolProf.${tool}`, tool)
				};
			}
		}
	},

	convertNotes: function (data, source) {
		if (source === 'obsidian' && getProperty(data, 'system.traits') !== undefined) {
			data.system.traits.size = CONVERT.size[data.flags.obsidian.details.size];
		} else if (source === 'core'
			&& data.type === 'character'
			&& getProperty(data, 'system.details') !== undefined)
		{
			for (const alignment of OBSIDIAN.Config.ALIGNMENTS) {
				const translation = game.i18n.localize(`OBSIDIAN.Alignment.${alignment}`);
				if (translation.toLowerCase() === data.system.details.alignment.toLowerCase()) {
					data.system.details.alignment = alignment;
					break;
				}
			}
		}
	},

	convertSpecial: function (data, source) {
		if (source !== 'core') {
			return;
		}

		const flags = data.flags.obsidian;
		const dndFlags = getProperty(data, 'flags.dnd5e');

		if (dndFlags) {
			if (dndFlags.initiativeAdv) {
				flags.attributes.init.roll = 'adv';
			}
		}
	},

	convertSpell: function (data) {
		Object.entries(data.system.components)
			.filter(([_, v]) => v)
			.map(([k, _]) => CONVERT.spellComponents[k])
			.filter(component => component)
			.forEach(component => data.flags.obsidian.components[component] = true);
	},

	convertWeapon: function (data) {
		if (data.system.weaponType) {
			const type = data.system.weaponType;
			if (type.startsWith('martial')) {
				data.flags.obsidian.category = 'martial';
			}

			if (type === 'natural') {
				data.flags.obsidian.category = 'unarmed';
			}

			if (type.endsWith('R')) {
				data.flags.obsidian.type = 'ranged';
			}
		}

		if (data.system.properties) {
			Object.entries(data.system.properties)
				.filter(([_, v]) => v)
				.map(([k, _]) => CONVERT.tags[k])
				.filter(tag => tag)
				.forEach(tag => data.flags.obsidian.tags[tag] = true);
		}
	}
};

function lazyConvert () {
	const convert = (key, convert) => {
		if (CONVERT[key]) {
			return;
		}

		CONVERT[key] = {};
		convert.forEach(([p, t, r]) =>
			CONVERT[key][p] =
				new Map(Config[r].map(key =>
					[game.i18n.localize(`OBSIDIAN.${t}.${key}`).toLowerCase(), key])));
	};

	convert('profs', [
		['weaponProf', 'WeaponProf', 'PROF_WEAPON'],
		['armorProf', 'ArmourProf', 'PROF_ARMOUR'],
		['languages', 'Lang', 'PROF_LANG']
	]);

	convert('defs', [
		['conditions', 'Condition', 'CONVERT_CONDITIONS'],
		['damage', 'Damage', 'CONVERT_DAMAGE_TYPES']
	]);

	CONVERT.defs.conditions.set('paralyzed', 'paralysed');
	convertSpeeds();
}

function convertSpeeds () {
	if (CONVERT.speeds) {
		return;
	}

	CONVERT.speeds =
		new Map(Config.SPEEDS.map(key =>
			[game.i18n.localize(`OBSIDIAN.SpeedAbbr.${key}`).toLowerCase(), key]));

	CONVERT.speeds.hover = new RegExp(`\(${game.i18n.localize('OBSIDIAN.Hover')}\)`);
}

function translateOrElseOriginal (key, original) {
	const translation = game.i18n.localize(key);
	return translation === key ? original : translation;
}
