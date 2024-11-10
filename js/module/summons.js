import { OBSIDIAN } from '../global.js';
import { Schema } from '../data/schema.js';
import { Effect } from './effect.js';
import { ObsidianActor } from './actor.js';

export const Summons = {
	addBonusDamage: function (summoner, summonData, bonus) {
		const extra = Summons.calculateBonus(summoner, summonData.flags.obsidian.summon, bonus);
		summonData.items.forEach(item => {
			if (!item.flags?.obsidian?.effects?.length) {
				return;
			}

			item.flags.obsidian.effects
				.flatMap(e => e.components)
				.filter(c => c.type === 'damage')
				.forEach(c => c.bonus += extra);
		});
	},

	applySummonOverrides: async function (options, summonData, summonType) {
		const summoner = ObsidianActor.fromUUID(options.summoner);
		if (!summoner) {
			return;
		}

		const component = summoner.obsidian.components.get(options.parentComponent);
		if (!component) {
			return;
		}

		if (component.prof) {
			await Summons.replaceProf(summoner, summonData, summonType);
		}

		const summonFlags = summonData.flags.obsidian;
		if (component.ac.enabled) {
			const current = Number(summonFlags.attributes?.ac?.override);
			mergeObject(summonFlags, {
				'attributes.ac.override':
					current + Summons.calculateBonus(summoner, summonFlags.summon, component.ac)
			});
		}

		if (component.hp.enabled) {
			const extra = Summons.calculateBonus(summoner, summonFlags.summon, component.hp);
			const current = summonData.system.attributes.hp;

			mergeObject(summonData.system, {
				'attributes.hp': {
					value: current.value + extra,
					max: current.max + extra
				}
			});
		}

		if (component.tmp.enabled) {
			const extra = Summons.calculateBonus(summoner, summonFlags.summon, component.tmp);
			const current = summonData.system.attributes.hp.temp;
			mergeObject(summonData.system, {'attributes.hp.temp': current + extra});
		}

		if (component.dmg.enabled) {
			Summons.addBonusDamage(summoner, summonData, component.dmg);
		}

		if (!OBSIDIAN.notDefinedOrEmpty(component.attack)) {
			Summons.replaceAttackBonuses(summoner, summonData, component.attack);
		}

		if (!OBSIDIAN.notDefinedOrEmpty(component.save)) {
			Summons.replaceSaveDCs(summoner, summonData, component.save);
		}
	},

	calculateBonus: function (actor, summon, bonus) {
		let multiplier = 1;
		let constant = 0;
		let total = 0;

		if (bonus.operator === 'plus') {
			constant += bonus.bonus ?? 0;
		} else if (bonus.operator === 'mult') {
			multiplier = bonus.bonus ?? 0;
		}

		const system = actor.system;
		if (bonus.key === 'abl') {
			total = system.abilities[bonus.ability].mod;
		} else if (bonus.key === 'prof') {
			total = system.attributes.prof;
		} else if (bonus.key === 'chr') {
			total = actor.type === 'npc' ? system.details.cr : system.details.level;
		} else if (bonus.key === 'cls') {
			total = actor.items.get(bonus.class).system.levels;
		} else if (bonus.key === 'hp') {
			total = system.attributes.hp.max;
		} else if (bonus.key === 'spell') {
			total = summon.spellLevel || 0;
		} else if (bonus.key === 'upcast') {
			total = summon.upcast || 0;
		}

		return multiplier * total + constant;
	},

	getAbilityBonus: function (summoner, summonData, ability) {
		if (ability === 'spell') {
			const spellcasting =
				Summons.getSpellcasting(summoner, summonData.flags.obsidian.summon);

			return spellcasting?.attack;
		}

		return summoner.system.abilities[ability].mod;
	},

	getGenericActor: async function (type) {
		const actor =
			game.actors.contents.find(actor =>
				actor.name === OBSIDIAN.GENERIC_ACTOR && actor.type === type);

		if (actor) {
			return actor;
		}

		return Actor.create({name: OBSIDIAN.GENERIC_ACTOR, type: type, token: {actorLink: false}});
	},

	getRootItem: function (actor, summon, item) {
		const derived = actor.obsidian;
		const parentComponent = item?.getFlag('obsidian', 'parentComponent') ?? summon.parentComponent;
		const component = derived.components.get(parentComponent);
		const effect = derived.effects.get(component.parentEffect);
		const parentItem = actor.items.get(effect.parentItem);

		if (parentItem.getFlag('obsidian', 'isEmbedded') && parentItem.getFlag('obsidian', 'parentComponent')) {
			return Summons.getRootItem(actor, summon, parentItem);
		}

		return parentItem;
	},

	getSpellcasting: function (actor, summon) {
		const item = Summons.getRootItem(actor, summon);
		const source = item.flags.obsidian.source;

		if (source.type !== 'class') {
			return;
		}

		const cls = actor.items.get(source.class);
		if (!cls?.obsidian?.spellcasting?.enabled) {
			return;
		}

		return cls.obsidian.spellcasting;
	},

	replaceAttackBonuses: function (summoner, summonData, ability) {
		const bonus = Summons.getAbilityBonus(summoner, summonData, ability);
		if (bonus == null) {
			return;
		}

		summonData.items.forEach(item => {
			if (!item.flags?.obsidian?.effects?.length) {
				return;
			}

			item.flags.obsidian.effects
				.flatMap(e => e.components)
				.filter(c => c.type === 'attack')
				.forEach(c => {
					c.ability = '';
					c.bonus = bonus;
					c.proficient = false;
				});
		});
	},

	replaceProf: async function (summoner, summonData, summonType) {
		if (!['character', 'npc'].includes(summonType)) {
			return;
		}

		const targetProf = summoner.system.attributes.prof;
		if (summonType === 'npc') {
			// Set the CR to give the appropriate resulting proficiency bonus.
			summonData.system.details.cr = (targetProf - 2) * 4 + 1;
			return;
		}

		// Create a feat that sets the proficiency.
		const feat = {
			name: game.i18n.localize('OBSIDIAN.ReplaceProf'),
			type: 'feat',
			flags: {
				obsidian: {
					version: Schema.VERSION,
					effects: []
				}
			}
		};

		const effect = Effect.create();
		const setter = Effect.createComponent('setter');
		const filter = Effect.createComponent('filter');

		setter.score = targetProf;
		filter.filter = 'score';
		filter.score = 'prof';
		effect.components.push(setter, filter);
		feat.flags.obsidian.effects.push(effect);
		summonData.items.push(new CONFIG.Item.documentClass(feat));
	},

	replaceSaveDCs: function (summoner, summonData, ability) {
		let dc = 8 + summoner.system.attributes.prof;
		if (ability === 'spell') {
			const spellcasting = Summons.getSpellcasting(summoner, summonData.flags.obsidian.summon);
			if (spellcasting) {
				dc = spellcasting.save;
			}
		} else {
			dc += Summons.getAbilityBonus(summoner, summonData, ability) ?? 0;
		}

		summonData.items.forEach(item => {
			if (!item.flags?.obsidian?.effects?.length) {
				return;
			}

			item.flags.obsidian.effects
				.flatMap(e => e.components)
				.filter(c => c.type === 'save')
				.forEach(c => {
					c.calc = 'fixed';
					c.fixed = dc;
				});
		});
	},

	summon: async function (uuid, amount, x, y, options) {
		const actor = await fromUuid(uuid);
		if (!actor) {
			return;
		}

		let tokenData =
			(await actor.getTokenDocument({x, y, actorLink: false, actorData: {flags: {}}})).toObject();

		// Use duplicate here to delete any shimmed properties.
		tokenData = duplicate(tokenData);
		delete tokenData.delta;

		if (actor.compendium) {
			// Since this actor doesn't actually exist in the world, and only
			// exists inside a compendium, we reference a generic actor, and
			// override all its data with the desired actor. This way we avoid
			// creating a world actor every time we want to summon something.
			const template = await Summons.getGenericActor(actor.type);
			tokenData.actorId = template.id;
		}

		tokenData.actorData = {
			name: actor.name,
			system: duplicate(actor._source.system),
			flags: duplicate(actor._source.flags),
			items: duplicate(actor._source.items)
		};

		// Make sure the summoner has access to their summon.
		tokenData.actorData.ownership = duplicate(actor.ownership);
		if (!game.user.isGM) {
			tokenData.actorData.ownership[game.userId] = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
		}

		const flags = tokenData.actorData.flags;
		if (!flags.obsidian) {
			flags.obsidian = {};
		}

		if (!flags.obsidian.version) {
			flags.obsidian.version = Schema.VERSION;
		}

		flags.obsidian.summon = {
			parentComponent: options.parentComponent,
			spellLevel: options.spellLevel == null ? undefined : Number(options.spellLevel),
			upcast: options.upcast == null ? undefined : Number(options.upcast),
			summoner: options.summoner
		};

		await Summons.applySummonOverrides(options, tokenData.actorData, actor.type);

		const tokens = [];
		amount = Math.clamped(amount, 0, 32);

		for (let i = 0; i < amount; i++) {
			tokens.push(duplicate(tokenData));
		}

		return canvas.scene.createEmbeddedDocuments('Token', tokens);
	}
};
