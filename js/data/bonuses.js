import {Filters} from './filters.js';
import {OBSIDIAN} from '../global.js';
import {Effect} from '../module/effect.js';
import {ObsidianActor} from '../module/actor.js';

export function applyBonuses (actor, system, flags, derived) {
	applySpeedBonuses(actor, system, derived);
	applyInitBonuses(actor, system, flags, derived);
	applyACBonuses(actor, system, flags);
	applyHPBonuses(actor, system, derived);
	applySpellBonuses(actor, derived);
}

function applyInitBonuses (actor, system, flags, derived) {
	if (!OBSIDIAN.notDefinedOrEmpty(flags.attributes.init.override)) {
		return;
	}

	const bonuses =
		derived.filters.bonuses(Filters.appliesTo.initiative(flags.attributes.init.ability));

	if (bonuses.length) {
		derived.attributes.init.rollParts.push(
			...bonuses.flatMap(bonus => bonusToParts(actor, bonus)));
	}

	system.attributes.init.mod +=
		derived.attributes.init.rollParts.reduce((acc, part) => acc + part.mod, 0);
	system.attributes.init.mod = Math.floor(system.attributes.init.mod);
}

function applyACBonuses (actor, system, flags) {
	if (!OBSIDIAN.notDefinedOrEmpty(flags.attributes.ac.override)) {
		return;
	}

	const ac = system.attributes.ac;
	ac.value += Effect.applyBonuses(actor, Filters.isAC);
	ac.value = Effect.applyMultipliers(actor, Filters.isAC, ac.value);
	ac.value = Effect.applySetters(actor, Filters.isAC, ac.value);
}

function applyHPBonuses (actor, system, derived) {
	const hp = system.attributes.hp;
	hp.max += Effect.applyBonuses(actor, Filters.isHP);
	hp.max = Effect.applyMultipliers(actor, Filters.isHP, hp.max);
	hp.max = Effect.applySetters(actor, Filters.isHP, hp.max);

	if (derived.conditions.exhaustion > 3) {
		system.attributes.hp.max = Math.floor(system.attributes.hp.max / 2);
	}
}

function applySpellBonuses (actor, derived) {
	if (actor.type === 'vehicle') {
		return;
	}

	const classSpellcasting = derived.classes.reduce((acc, cls) => {
		if (cls.obsidian?.spellcasting?.enabled) {
			acc.push(cls.obsidian.spellcasting);
		}
		return acc;
	}, []);

	[['spellAttacks', 'attacks'], ['spellDCs', 'saves']].forEach(([filter, key]) => {
		const total = Effect.applyBonuses(actor, Filters.appliesTo[filter]);
		derived.spellcasting[key] = derived.spellcasting[key].map(val => val + total);
		classSpellcasting.forEach(spellcasting => spellcasting[key.slice(0, key.length - 1)] += total);
	});

	const multipliers = derived.filters.multipliers(Filters.appliesTo.spellDCs);
	if (multipliers.length) {
		const total = multipliers.reduce((acc, mult) => acc * (mult.multiplier ?? 1), 1);
		derived.spellcasting.saves =
			derived.spellcasting.saves.map(save => Math.floor(save * total));
		classSpellcasting.forEach(spellcasting => spellcasting.save = Math.floor(spellcasting.save * total));
	}

	const setters = derived.filters.setters(Filters.appliesTo.spellDCs);
	if (setters.length) {
		const setter = Effect.combineSetters(setters);
		derived.spellcasting.saves = derived.spellcasting.saves.map(save => {
			if (!setter.min || setter.score > save) {
				return setter.score;
			}

			return save;
		});
		classSpellcasting.forEach(spellcasting => {
			if (!setter.min || setter.score > spellcasting.save) {
				spellcasting.save = setter.score;
			}
		});
	}
}

function applySpeedBonuses (actor, system, derived) {
	if (actor.type === 'vehicle') {
		return;
	}
	const conditions = derived.conditions;
	const exhaustion = conditions.exhaustion;

	for (const key of OBSIDIAN.Config.SPEEDS) {
		const speeds = system.attributes.movement;
		if (speeds[key] === null) {
			continue;
		}

		const filter = Filters.appliesTo.speedScores(key);
		speeds[key] += Effect.applyBonuses(actor, filter);
		speeds[key] = Effect.applyMultipliers(actor, filter, speeds[key]);
		speeds[key] = Effect.applySetters(actor, filter, speeds[key]);

		if (exhaustion > 4 || conditions.grappled || conditions.paralysed || conditions.petrified
			|| conditions.restrained || conditions.stunned || conditions.unconscious
			|| ObsidianActor.isRuleActive(actor, 'overCapacity'))
		{
			speeds[key] = 0;
			continue;
		}

		if (exhaustion > 1) {
			speeds[key] = Math.floor(speeds[key] / 2);
		}

		if (ObsidianActor.isRuleActive(actor, 'heavyArmour')) {
			speeds[key] -= 10;
		}

		if (ObsidianActor.isRuleActive(actor, 'heavilyEncumbered')) {
			speeds[key] -= 20;
		} else if (ObsidianActor.isRuleActive(actor, 'encumbered')) {
			speeds[key] -= 10;
		}
	}
}

export function applyProfBonus (actor) {
	const attr = actor.system.attributes;
	attr.prof += Effect.applyBonuses(actor, Filters.isProf);
	attr.prof = Effect.applyMultipliers(actor, Filters.isProf, attr.prof);
	attr.prof = Effect.applySetters(actor, Filters.isProf, attr.prof);
}

function bonusName (actor, bonus) {
	if (bonus.name?.length) {
		return bonus.name;
	}

	const effect = actor.obsidian.effects.get(bonus.parentEffect);
	if (!effect) {
		return '';
	}

	if (effect.name.length) {
		return effect.name;
	}

	const item = actor.items.get(effect.parentItem);
	return item.name;
}

export function getTokenActorSafe (uuid) {
	// Try to avoid causing an infinite recursion loop of Actor.prepareData().
	const parts = uuid.split('.');
	if (parts[0] === 'Actor') {
		const actor = game.actors?.get(parts[1]);
		if (actor) {
			return actor;
		}
	} else {
		const scene = game.scenes.get(parts[1]);
		if (!scene) {
			return;
		}

		const token = scene.tokens.get(parts[3]);
		if (!token) {
			return;
		}

		const actor = game.actors.get(token.actorId);
		if (!actor) {
			return;
		}

		if (token.actorLink) {
			return actor;
		}

		const cached = game.actors.tokens[token.id];
		if (cached) {
			return cached;
		}

		const merged =
			mergeObject(actor.toObject(false), token.toObject(false).actorData, {inplace: false});

		return new Actor.implementation(merged);
	}
}

export function bonusToParts (actor, bonus) {
	let summoningItem;
	const effect = actor.obsidian.effects.get(bonus.parentEffect);

	if (effect?.activeEffect) {
		const item = actor.items.get(effect.parentItem);
		if (item?.flags.obsidian?.duration) {
			const tokenActor = getTokenActorSafe(item.flags.obsidian.duration.uuid);
			if (tokenActor) {
				actor = tokenActor;
			}
		}
	}

	if ((!bonus.formula || bonus.method === 'formula')
		&& bonus.summoner && actor.flags.obsidian?.summon)
	{
		const tokenActor = getTokenActorSafe(actor.flags.obsidian.summon.summoner);
		if (tokenActor) {
			const component =
				tokenActor.obsidian.components.get(
					actor.flags.obsidian.summon.parentComponent);

			if (component) {
				const effect = tokenActor.obsidian.effects.get(component.parentEffect);
				if (effect) {
					summoningItem = tokenActor.items.get(effect.parentItem);
				}
			}

			actor = tokenActor;
		}
	}

	// Is this an actual bonus component or has it been tacked onto a different
	// component?
	const isComponent = bonus.formula;
	const prof = actor.system.attributes.prof;
	const summoningItemSource = summoningItem?.getFlag('obsidian', 'source');
	const parts = [];

	const createConstantPart = mod => parts.push({mod, name: bonusName(actor, bonus)});

	const createAbilityPart = (multiplier, constant) => {
		let mod = 0;
		if (bonus.ability === 'spell' && summoningItemSource?.type === 'class') {
			const cls = actor.items.get(summoningItemSource.class);
			if (cls?.obsidian?.spellcasting?.enabled) {
				mod = cls.obsidian.spellcasting.mod;
			}
		} else if (bonus.ability !== 'spell') {
			mod = actor.system.abilities[bonus.ability].mod;
		}

		parts.push({
			mod: Math.floor(multiplier * mod + constant),
			name:
				bonus.name.length
					? bonus.name
					: game.i18n.localize(`OBSIDIAN.AbilityAbbr.${bonus.ability}`)
		});
	};

	const createProfPart = (mod, value, name) =>
		parts.push({
			value,
			proficiency: true,
			mod: Math.floor(mod),
			name: name?.length ? name : game.i18n.localize('OBSIDIAN.ProfAbbr')
		});

	const createDicePart = (mod = 0) => {
		const part = {mod, ndice: bonus.ndice, die: bonus.die, name: bonusName(actor, bonus)};
		if (bonus.dmg?.enabled && bonus.dmg?.type !== 'wpn') {
			part.damage = bonus.dmg.type;
		}

		parts.push(part);
	};

	const createLevelPart = (key, multiplier = 1, constant = 0) => {
		let level;
		if (key === 'chr') {
			level = actor.system.details.level;
		} else if (key === 'cls') {
			const cls = actor.items.get(bonus.class);
			level = cls?.system.levels;
		}

		if (level) {
			parts.push({
				mod: Math.floor(multiplier * level + constant),
				name: bonusName(actor, bonus)
			});
		}
	};

	if (isComponent) {
		if (bonus.method === 'dice') {
			createDicePart(bonus.bonus || 0);
		} else if (bonus.method === 'formula') {
			let constant = 0;
			let multiplier = 1;

			if (bonus.operator === 'plus') {
				constant = bonus.constant || 0;
			} else if (bonus.operator === 'mult') {
				multiplier = bonus.constant || 0;
			}

			if (bonus.value === 'prof') {
				createProfPart(multiplier * prof + constant, multiplier, bonus.name);
			} else if (bonus.value === 'abl') {
				createAbilityPart(multiplier, constant);
			} else if (['chr', 'cls'].includes(bonus.value)) {
				createLevelPart(bonus.value, multiplier, constant);
			} else if (constant) {
				createConstantPart(constant);
			}
		}
	} else {
		if (bonus.ndice) {
			createDicePart();
		}

		if (!OBSIDIAN.notDefinedOrEmpty(bonus.prof)) {
			createProfPart(bonus.prof * prof, Number(bonus.prof));
		}

		if (!OBSIDIAN.notDefinedOrEmpty(bonus.level)) {
			createLevelPart(bonus.level);
		}
	}

	return parts;
}

export function highestProficiency (parts) {
	const highest = parts.reduce((acc, part) =>
		part.proficiency && part.mod > acc.mod ? part : acc, {mod: -Infinity});

	const newParts = [];
	let hasProficiency = false;

	for (const part of parts) {
		if (!part.proficiency) {
			newParts.push(part);
			continue;
		}

		if (part.mod >= highest.mod && !hasProficiency) {
			newParts.push(part);
			hasProficiency = true;
		}
	}

	return newParts;
}
