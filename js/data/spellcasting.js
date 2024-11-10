import {OBSIDIAN} from '../global.js';

export function prepareSpellcasting (actor, system, flags, derived) {
	const mods = [];
	const attacks = [];
	const saves = [];
	const existing = {};

	derived.spellcasting = {mods, attacks, saves};
	for (const cls of derived.classes) {
		const spellcasting = cls.obsidian.spellcasting;
		if (spellcasting?.enabled
			&& !OBSIDIAN.notDefinedOrEmpty(spellcasting.ability)
			&& !existing[spellcasting.ability])
		{
			mods.push(spellcasting.mod);
			attacks.push(spellcasting.attack);
			saves.push(spellcasting.save);
			existing[spellcasting.ability] = true;
		}
	}

	if (actor.type === 'npc' && !OBSIDIAN.notDefinedOrEmpty(system.attributes.spellcasting)) {
		const mod = system.abilities[system.attributes.spellcasting].mod;
		system.attributes.spellMod = mod;
		system.attributes.spellAtk = mod + system.attributes.prof;
		system.attributes.spelldc = mod + system.attributes.prof + 8;

		if (!OBSIDIAN.notDefinedOrEmpty(flags.spells.attack)) {
			system.attributes.spellAtk = flags.spells.attack;
		}

		if (!OBSIDIAN.notDefinedOrEmpty(flags.spells.save)) {
			system.attributes.spelldc = flags.spells.save;
		}

		if (!existing[system.attributes.spellcasting]) {
			mods.push(system.attributes.spellMod);
			attacks.push(system.attributes.spellAtk);
			saves.push(system.attributes.spelldc);
		}
	}

	if (system.spells.pact) {
		const levelOverride = flags.spells?.slots.pactLevel;
		if (!OBSIDIAN.notDefinedOrEmpty(levelOverride)) {
			system.spells.pact.level = Number(levelOverride);
		}
	}

	if (actor.type === 'npc' && !OBSIDIAN.notDefinedOrEmpty(flags.spells?.slots.pactLevel)) {
		const lvl = system.details.spellLevel;
		system.spells.pact = system.spells.pact || {};
		system.spells.pact.level = Number(flags.spells?.slots.pactLevel);

		if (system.spells.pact.override) {
			system.spells.pact.max = system.spells.pact.override;
		} else {
			system.spells.pact.max =
				Math.max(1, Math.min(lvl, 2), Math.min(lvl - 8, 3), Math.min(lvl - 13, 4));
		}

		system.spells.pact.value = Math.min(system.spells.pact.value, system.spells.pact.max);
	}
}
