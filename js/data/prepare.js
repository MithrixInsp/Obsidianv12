import {OBSIDIAN} from '../global.js';
import {Filters} from './filters.js';
import { bonusToParts, getTokenActorSafe, highestProficiency } from './bonuses.js';
import {Effect} from '../module/effect.js';
import {Config} from './config.js';
import {conditionsRollMod} from '../module/conditions.js';
import {Schema} from './schema.js';

const ops = {
	plus: (a, b) => a + b,
	mult: (a, b) => a * b
};

/**
 * Determines whether a given roll has advantage, disadvantage, or neither,
 * depending on all the modifiers applied to the roll.
 * @param mods An array of strings with values of 'adv', 'dis', or 'reg'.
 * @return {number} Returns 1 for advantage, -1 for disadvantage, and 0 for
 *                  neither.
 */
export function determineAdvantage (...mods) {
	let hasAdvantage = mods.some(mod => mod === 'adv');
	let hasDisadvantage = mods.some(mod => mod === 'dis');

	if (hasAdvantage && hasDisadvantage) {
		return 0;
	}

	if (hasAdvantage) {
		return 1;
	}

	if (hasDisadvantage) {
		return -1;
	}

	return 0;
}

export function determineMode (...mods) {
	const adv = determineAdvantage(...mods);
	return adv > 0 ? 'adv' : adv === 0 ? 'reg' : 'dis';
}

export const Prepare = {
	spellPart: function (component, system, cls) {
		if (!OBSIDIAN.notDefinedOrEmpty(component.ability) && system) {
			let mod;
			let i18n;

			if (component.ability === 'spell') {
				component.spellMod = 0;
				if (cls?.obsidian?.spellcasting != null) {
					component.spellMod = cls.obsidian.spellcasting.mod;
				} else if (!OBSIDIAN.notDefinedOrEmpty(system.attributes.spellcasting)) {
					component.spellMod = system.abilities[system.attributes.spellcasting].mod;
				}

				mod = component.spellMod;
				i18n = 'OBSIDIAN.Spell';
			} else {
				mod = system.abilities[component.ability].mod;
				i18n = `OBSIDIAN.AbilityAbbr.${component.ability}`;
			}

			component.rollParts.push({mod: mod, name: game.i18n.localize(i18n)});
		}
	},

	calculateDC: function (actor, item, component, cls, pred) {
		const system = actor?.system;
		if (component.calc === 'fixed') {
			component.value = component.fixed;
			return;
		}

		let bonus = 8;
		if (!OBSIDIAN.notDefinedOrEmpty(component.bonus)) {
			bonus = Number(component.bonus);
		}

		component.rollParts = [{
			mod: component.prof * (system?.attributes.prof || 0),
			name: game.i18n.localize('OBSIDIAN.ProfAbbr'),
			proficiency: true,
			value: Number(component.prof)
		}];

		component.spellMod = 0;
		if (item.getFlag('obsidian', 'parentComponent')) {
			const provider =
				actor?.obsidian?.components.get(item.flags.obsidian.parentComponent);

			if (provider && provider.method === 'innate') {
				component.spellMod = system.abilities[provider.ability].mod;
				component.rollParts.push({
					mod: component.spellMod,
					name: game.i18n.localize('OBSIDIAN.Spell')
				});
			} else {
				Prepare.spellPart(component, system, cls);
			}
		} else {
			Prepare.spellPart(component, system, cls);
		}

		const bonuses = actor?.obsidian?.filters.bonuses(pred(component)) || [];
		if (bonuses.length) {
			component.rollParts.push(...bonuses.flatMap(bonus => bonusToParts(actor, bonus)));
		}

		component.value =
			Math.floor(bonus + component.rollParts.reduce((acc, part) => acc + part.mod, 0));

		if (actor?.obsidian) {
			const filter = pred(component);
			component.value = Effect.applyMultipliers(actor, filter, component.value);
			component.value = Effect.applySetters(actor, filter, component.value);
		}
	},

	calculateHit: function (actor, item, hit, cls) {
		const system = actor?.system;

		hit.rollParts = [{
			mod: (hit.bonus || 0) + weaponBonus(actor, item),
			name: game.i18n.localize('OBSIDIAN.Bonus')
		}];

		hit.spellMod = 0;
		hit.targets = 1;
		Prepare.spellPart(hit, system, cls);

		if (hit.proficient) {
			hit.rollParts.push({
				mod: system?.attributes.prof || 0,
				name: game.i18n.localize('OBSIDIAN.ProfAbbr'),
				proficiency: true,
				value: 1
			});
		}

		const bonuses = actor?.obsidian?.filters.bonuses(Filters.appliesTo.attackRolls(hit)) || [];
		if (bonuses.length) {
			hit.rollParts.push(...bonuses.flatMap(bonus => bonusToParts(actor, bonus)));
		}

		if (hit.extraBonus && actor) {
			hit.rollParts.push(...bonusToParts(actor, hit.extraBonus));
		}

		hit.rollParts = highestProficiency(hit.rollParts);
		hit.value = hit.rollParts.reduce((acc, part) => acc + part.mod, 0);
		hit.attackType =
			game.i18n.localize(
				`OBSIDIAN.${hit.attack.capitalize()}${hit.category.capitalize()}Attack`);
	},

	calculateDamage: function (actor, item, dmg, cls) {
		const system = actor?.system;

		dmg.rollParts = [{
			mod: dmg.bonus || 0,
			name: game.i18n.localize('OBSIDIAN.Bonus'),
			constant: true
		}, {
			mod: weaponBonus(actor, item),
			name: game.i18n.localize('OBSIDIAN.Magic')
		}];

		Prepare.spellPart(dmg, system, cls);

		if (actor?.obsidian) {
			const bonuses = Effect.filterDamage(actor, actor.obsidian.filters.bonuses, dmg);
			if (bonuses.length) {
				dmg.rollParts.push(...bonuses.flatMap(bonus => bonusToParts(actor, bonus)));
			}
		}

		if (dmg.extraBonus && actor) {
			dmg.rollParts.push(...bonusToParts(actor, dmg.extraBonus));
		}

		dmg.mod = dmg.rollParts.reduce((acc, part) => acc + part.mod, 0);
		dmg.derived = {ncrit: dmg.ndice, ndice: dmg.ndice};
		dmg.display = Prepare.damageFormat(dmg);

		if (!OBSIDIAN.notDefinedOrEmpty(dmg.ncrit)) {
			dmg.derived.ncrit = Number(dmg.ncrit);
		}
	},

	calculateResources: function (actor, item, effect, resource) {
		const system = actor?.system;

		if (resource.calc === 'fixed') {
			resource.max = resource.fixed;
		} else if (actor) {
			const op = ops[resource.operator];
			if (resource.key === 'abl') {
				let abl = system.abilities[resource.ability].mod;
				if (resource.summoner && actor.flags.obsidian?.summon) {
					const tokenActor = getTokenActorSafe(actor.flags.obsidian.summon.summoner);
					if (tokenActor) {
						abl = tokenActor.system.abilities[resource.ability].mod;
					}
				}
				resource.max = op(resource.bonus, abl);
			} else if (resource.key === 'chr') {
				resource.max = op(resource.bonus, system.details.level);
			} else if (resource.key === 'cls' && actor.obsidian) {
				const cls = actor.items.get(resource.class);
				if (cls) {
					resource.max = op(resource.bonus, cls.system.levels);
				}
			} else if (resource.key === 'prof') {
				resource.max = op(resource.bonus, system.attributes.prof);
			}

			resource.max = Math.max(resource.min, resource.max);
		}

		if (resource.remaining === undefined) {
			resource.remaining = resource.max;
		} else if (resource.remaining < 0) {
			resource.remaining = 0;
		}

		resource.display = Prepare.usesFormat(item, effect, resource, 6);
	},

	calculateAttackType: function (flags, atk) {
		if (atk.category === 'spell' || flags.category === undefined) {
			atk.attackType =
				`OBSIDIAN.${atk.attack.capitalize()}${atk.category.capitalize()}Attack`;
			return;
		}

		atk.attackType = 'OBSIDIAN.MeleeWeaponAttack';
		if (flags.category === 'unarmed') {
			atk.mode = 'unarmed';
		} else if (flags.type === 'ranged') {
			atk.mode = 'ranged';
		} else if (!atk.mode
			|| (atk.mode === 'versatile' && !flags.tags.versatile)
			|| (atk.mode === 'ranged' && !flags.tags.thrown))
		{
			atk.mode = 'melee'
		}

		if (atk.mode === 'ranged') {
			atk.attackType = 'OBSIDIAN.RangedWeaponAttack';
		}
	},

	calculateSkill: function (system, flags, skill, original) {
		let prof = skill.value;
		if (prof === 0 && flags.skills.joat) {
			prof = .5;
		}

		if (prof > 0.5 && original && original.value > prof) {
			prof = original.value;
		}

		if (OBSIDIAN.notDefinedOrEmpty(skill.override)) {
			skill.mod = system.abilities[skill.ability].mod;
			skill.rollParts = [{
				mod: Math.floor(system.attributes.prof * prof),
				name: game.i18n.localize('OBSIDIAN.ProfAbbr'),
				proficiency: true,
				value: Number(prof)
			}, {
				mod: system.abilities[skill.ability].mod,
				name: game.i18n.localize(`OBSIDIAN.AbilityAbbr.${skill.ability}`)
			}, {
				mod: (flags.skills.bonus || 0) + (skill.bonus || 0),
				name: game.i18n.localize('OBSIDIAN.Bonus')
			}];
		} else {
			skill.mod = 0;
			skill.rollParts = [{
				mod: Number(skill.override),
				name: game.i18n.localize('OBSIDIAN.Override')
			}];
		}
	},

	damageFormat: function (dmg, mod = true) {
		if (dmg === undefined) {
			return;
		}

		let out = '';
		const ndice = dmg.derived.ndice;

		if (ndice > 0 && dmg.calc === 'formula') {
			out += `${ndice}d${dmg.die}`;
		}

		if (dmg.mod !== 0 && mod) {
			if (ndice > 0 && dmg.calc === 'formula' && dmg.mod > 0) {
				out += '+';
			}

			out += dmg.mod;
		}

		if (out.length < 1) {
			out = '0';
		}

		return out;
	},

	ac: function (system, flags) {
		const ac = system.attributes.ac;
		const acFlags = flags.attributes.ac;

		if (!OBSIDIAN.notDefinedOrEmpty(acFlags.override)) {
			ac.value = Number(acFlags.override);
			return;
		}

		ac.value = acFlags.base + system.abilities[acFlags.ability1].mod;

		if (!OBSIDIAN.notDefinedOrEmpty(acFlags.ability2)) {
			ac.value += system.abilities[acFlags.ability2].mod;
		}
	},

	abilities: function (actor, system, flags, derived) {
		derived.abilities = {};
		for (const [id, ability] of Object.entries(system.abilities)) {
			derived.abilities[id] = {rollParts: []};
			const abilityBonuses = derived.filters.bonuses(Filters.appliesTo.abilityChecks(id));

			if (abilityBonuses.length) {
				derived.abilities[id].rollParts.push(
					...abilityBonuses.flatMap(bonus => bonusToParts(actor, bonus)));
			}

			const filter = Filters.appliesTo.abilityScores(id);
			ability.value += Effect.applyBonuses(actor, filter);
			ability.value = Effect.applyMultipliers(actor, filter, ability.value);
			ability.value = Effect.applySetters(actor, filter, ability.value);
			ability.mod = Math.floor((ability.value - 10) / 2);
		}
	},

	armour: function (system, flags, derived) {
		derived.rules.heavyArmour = false;
		derived.rules.noisyArmour = false;
		derived.armour =
			derived.itemsByType.get('equipment').filter(item => item.flags.obsidian?.armour);

		const {armour, shield} = derived.armour.reduce((acc, item) => {
			const system = item.system;
			if (!system.equipped) {
				return acc;
			}

			if (system.armor.type === 'shield') {
				acc.shield = item;
			} else {
				acc.armour = item;
			}

			return acc;
		}, {});

		if (armour) {
			if (!OBSIDIAN.notDefinedOrEmpty(armour.system.strength)) {
				derived.rules.heavyArmour = system.abilities.str.value < armour.system.strength;
			}

			derived.rules.noisyArmour = armour.system.stealth;
		}

		if (!OBSIDIAN.notDefinedOrEmpty(flags.attributes.ac.override)) {
			derived.armourDisplay = '';
			return;
		}

		const armourDisplay = [];
		const ac = system.attributes.ac;

		if (armour) {
			const armourData = armour.system.armor;
			const armourFlags = armour.flags.obsidian;
			armourDisplay.push(armour.name.toLocaleLowerCase());
			ac.value = armourData.value;

			if (armourFlags.addDex) {
				ac.value += Math.min(system.abilities.dex.mod, armourData.dex ?? Infinity);
			}
		}

		if (shield) {
			armourDisplay.push(shield.name.toLocaleLowerCase());
			ac.value += shield.system.armor.value;
		}

		derived.armourDisplay = armourDisplay.join(', ');
	},

	conditions: function (actor, system, flags, derived) {
		const conditionImmunities = new Set(derived.defenses.parts.conditions.imm);
		derived.conditions = {exhaustion: 0};
		actor.effects.forEach(effect => {
			const id = effect.getFlag('core', 'statusId');
			if (!id) {
				return;
			}

			if (id.startsWith('exhaust')) {
				const level = Number(id.substr(7));
				if (level > derived.conditions.exhaustion) {
					derived.conditions.exhaustion = level;
				}

				return;
			}

			derived.conditions[id] = !conditionImmunities.has(id);
		});

		derived.filters.conditions.filter(component => component.temp).forEach(component => {
			if (component.condition === 'exhaustion') {
				derived.conditions.exhaustion++;
				if (derived.conditions.exhaustion > 6) {
					derived.conditions.exhaustion = 6;
				}
			} else {
				derived.conditions[component.condition] =
					!conditionImmunities.has(component.condition);
			}
		});

		if (conditionImmunities.has('exhaustion')) {
			derived.conditions.exhaustion = 0;
		}

		const conditionDefense = derived.defenses.parts.conditions;
		const damageDefense = derived.defenses.parts.damage;

		if (derived.conditions.petrified) {
			conditionDefense.imm.push('disease');
			conditionDefense.imm.push('poisoned');
			damageDefense.res.push(...Config.DAMAGE_TYPES.map(dmg => {
				return {dmg, level: 'res', magic: '', material: ''};
			}));
		}

		derived.conditions.concentrating =
			actor.effects
				.filter(item => getProperty(item, 'flags.obsidian.ref'))
				.map(duration => derived.effects.get(duration.flags.obsidian.ref))
				.some(effect => effect && Effect.isConcentration(actor, effect));
	},

	encumbrance: function (actor, system, derived) {
		const rules = derived.rules;
		const inventory = derived.inventory;
		const str = system.abilities.str.value;
		const thresholds = Config.ENCUMBRANCE_THRESHOLDS;
		const encumbrance = game.settings.get('obsidian', 'encumbrance');
		const sizeMod = Config.ENCUMBRANCE_SIZE_MOD[system.traits.size] || 1;

		if (actor.type === 'vehicle') {
			inventory.max = system.attributes.capacity.cargo;
		} else {
			inventory.max = str * sizeMod * CONFIG.DND5E.encumbrance.strMultiplier.imperial;
			inventory.max += Effect.applyBonuses(actor, Filters.isCarry);
			inventory.max = Effect.applyMultipliers(actor, Filters.isCarry, inventory.max);
			inventory.max = Effect.applySetters(actor, Filters.isCarry, inventory.max);
		}

		rules.encumbered = false;
		rules.heavilyEncumbered = false;
		rules.overCapacity = encumbrance < 2 && inventory.weight >= inventory.max;

		if (encumbrance === 1) {
			rules.encumbered = inventory.weight >= str * thresholds.encumbered;
			rules.heavilyEncumbered = inventory.weight >= str * thresholds.heavy;
		}
	},

	hd: function (flags, derived) {
		const classHD = {};
		const existingHD = flags.attributes.hd;

		for (const cls of derived.classes) {
			const die = cls.system.hitDice;
			let hd = classHD[die] || 0;
			hd += cls.system.levels;
			classHD[die] = hd;
		}

		for (const [die, hd] of Object.entries(existingHD)) {
			if (!OBSIDIAN.notDefinedOrEmpty(hd.override)) {
				hd.override = Number(hd.override);
			}

			if (!classHD[die]) {
				hd.max = 0;
			}
		}

		for (const [die, hd] of Object.entries(classHD)) {
			let existing = existingHD[die];
			if (existing === undefined) {
				existing = {value: hd, max: hd};
				existingHD[die] = existing;
			} else {
				existing.max = hd;
			}
		}
	},

	init: function (type, system, flags, derived) {
		derived.attributes.init.rollParts = [];
		system.attributes.init.mod =
			system.abilities[flags.attributes.init.ability].mod
			+ dnd5e.utils.simplifyBonus(system.attributes.init.bonus);

		if (flags.skills.joat) {
			system.attributes.init.mod += Math.floor(system.attributes.prof / 2);
		}

		if (type === 'vehicle' && flags.details.type !== 'land') {
			derived.attributes.init.rollParts.push({
				mod: flags.attributes.quality ?? 0,
				name: game.i18n.localize('OBSIDIAN.Quality')
			});
		}

		if (!OBSIDIAN.notDefinedOrEmpty(flags.attributes.init.override)) {
			system.attributes.init.mod = Number(flags.attributes.init.override);
		}
	},

	saves: function (actor, system, flags, derived, originalSaves) {
		derived.saves = {};
		for (const [id, ability] of Object.entries(system.abilities)) {
			const save = {};
			derived.saves[id] = save;

			if (!flags.saves[id]) {
				flags.saves[id] = {};
			}

			let original;
			if (originalSaves) {
				original = originalSaves[id];
			}

			if (OBSIDIAN.notDefinedOrEmpty(flags.saves[id].override)) {
				save.rollParts = [{
					mod: ability.proficient * system.attributes.prof,
					name: game.i18n.localize('OBSIDIAN.ProfAbbr'),
					proficiency: true,
					value: Number(ability.proficient)
				}, {
					mod: system.abilities[id].mod,
					name: game.i18n.localize(`OBSIDIAN.AbilityAbbr.${id}`)
				}, {
					mod: (flags.saves.bonus || 0) + (flags.saves[id].bonus || 0),
					name: game.i18n.localize('OBSIDIAN.Bonus')
				}];

				const saveBonuses = derived.filters.bonuses(Filters.appliesTo.savingThrows(id));
				if (saveBonuses.length) {
					save.rollParts.push(
						...saveBonuses.flatMap(bonus => bonusToParts(actor, bonus)));
					save.rollParts = highestProficiency(save.rollParts);
				}
			} else {
				save.rollParts = [{
					mod: Number(flags.saves[id].override),
					name: game.i18n.localize('OBSIDIAN.Override')
				}];
			}

			ability.proficient = save.rollParts.find(p => p.proficiency)?.value || 0;
			ability.save = Math.floor(save.rollParts.reduce((acc, part) => acc + part.mod, 0));

			if (ability.proficient > 0 && original && original.save > ability.save) {
				ability.save = original.save;
			}
		}
	},

	skills: function (actor, system, flags, derived, originalSkills) {
		const skills = new Set(Object.keys(system.skills).concat(Object.keys(flags.skills)));
		const skip = new Set(['bonus', 'joat', 'passives', 'roll']);

		// Legacy data.
		if (skills.has('custom') && Array.isArray(flags.skills?.custom)) {
			skills.delete('custom');
		}

		for (const id of skills) {
			if (skip.has(id)) {
				continue;
			}

			const fromData = system.skills[id] || {};
			const fromFlags = flags.skills[id] || {};
			const skill = mergeObject(fromData, fromFlags, {inplace: false});
			system.skills[id] = skill;

			let original;
			if (originalSkills) {
				original = originalSkills[id];
			}

			if (!skill.custom) {
				skill.label = game.i18n.localize(`OBSIDIAN.Skill.${id}`);
			}

			Prepare.calculateSkill(system, flags, skill, original);
			let filter = Filters.appliesTo.skillChecks(id, skill.ability);

			if (OBSIDIAN.notDefinedOrEmpty(skill.override)) {
				const bonuses = derived.filters.bonuses(filter);
				if (bonuses.length) {
					skill.rollParts.push(...bonuses.flatMap(bonus => bonusToParts(actor, bonus)));
					skill.rollParts = highestProficiency(skill.rollParts);
				}
			}

			const rollMods = derived.filters.mods(filter);
			const rollMod =
				Effect.combineRollMods(
					rollMods.concat(conditionsRollMod(actor, {ability: skill.ability, skill: id})));

			skill.total = Math.floor(skill.rollParts.reduce((acc, part) => acc + part.mod, 0));
			skill.proficiency = skill.rollParts.find(part => part.proficiency);

			if (skill.proficiency?.value > 0.5 && original && original.total > skill.total) {
				skill.total = original.total;
			}

			filter = Filters.appliesTo.passiveScores(id);
			skill.key = id;
			skill.passive = 10 + skill.total + (skill.passiveBonus || 0);
			skill.passive += 5 * determineAdvantage(skill.roll, flags.skills.roll, ...rollMod.mode);
			skill.passive += Effect.applyBonuses(actor, filter);
			skill.passive = Effect.applyMultipliers(actor, filter, skill.passive);
			skill.passive = Effect.applySetters(actor, filter, skill.passive);
		}
	},

	tools: function (actor, system, flags, derived) {
		if (!system.tools) {
			system.tools = {};
		}

		const tools = new Set(Config.ALL_TOOLS.concat(Object.keys(flags.tools)));

		// Legacy data.
		if (tools.has('custom') && Array.isArray(flags.tools?.custom)) {
			tools.delete('custom');
		}

		for (const id of tools) {
			const tool = duplicate(Schema.Tool);
			mergeObject(tool, flags.tools[id] || {});
			flags.tools[id] = system.tools[id] = tool;

			if (tool.custom) {
				tool.enabled = true;
			} else {
				tool.label = game.i18n.localize(`OBSIDIAN.ToolProf.${id}`);
			}

			Prepare.calculateSkill(system, flags, tool);
			if (OBSIDIAN.notDefinedOrEmpty(tool.override)) {
				const bonuses =
					derived.filters.bonuses(Filters.appliesTo.toolChecks(id, tool.ability));

				if (bonuses.length) {
					tool.rollParts.push(...bonuses.flatMap(bonus => bonusToParts(actor, bonus)));
					tool.rollParts = highestProficiency(tool.rollParts);
				}
			}

			tool.key = id;
			tool.total = tool.rollParts.reduce((acc, part) => acc + part.mod, 0);
			tool.proficiency = tool.rollParts.find(part => part.proficiency);
			tool.bonuses = {};
		}
	},

	usesFormat: function (item, effect, resource, threshold = 10) {
		if (resource.max === undefined || resource.max < 0) {
			return '';
		}

		const max = Math.max(resource.max, resource.remaining);
		let used = max - resource.remaining;

		if (used < 0) {
			used = 0;
		}

		let out = `<div class="obsidian-feature-uses" data-component-id="${resource.uuid}">`;
		if (max <= threshold) {
			for (let i = 0; i < max; i++) {
				out += `
					<div class="obsidian-feature-use
                         ${i < used ? 'obsidian-feature-used' : ''}
                         ${max - i > resource.max ? 'obsidian-feature-positive' : ''}"
					     data-n="${i + 1}">&times;</div>
				`;
			}
		} else {
			out += `
				<input type="number" class="obsidian-input-sheet" value="${resource.remaining}"
				       data-name="items.${item.idx}.flags.obsidian.effects.${effect.idx}.components.${resource.idx}.remaining"
				       data-dtype="Number">
				<span class="obsidian-binary-operator">&sol;</span>
				<span class="obsidian-feature-max">${resource.max}</span>
			`;
		}

		out += '</div>';
		return out;
	}
};

function weaponBonus (actor, item) {
	let bonus = 0;
	if (item?.type !== 'weapon') {
		return bonus;
	}

	const flags = item.flags.obsidian;
	if (flags.magical && flags.magicBonus) {
		bonus += flags.magicBonus;
	}

	if (flags.tags.ammunition && !OBSIDIAN.notDefinedOrEmpty(flags.ammo)) {
		const ammo = actor?.items.get(flags.ammo);
		if (ammo) {
			const ammoFlags = ammo.flags.obsidian;
			if (ammoFlags.magical && ammoFlags.magicBonus) {
				bonus += ammoFlags.magicBonus;
			}
		}
	}

	return bonus;
}
