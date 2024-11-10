import {CONVERT} from './convert.js';

export const v12 = {
	convertSenses: function (data) {
		if (!data.flags.obsidian?.attributes?.senses || !data.system.attributes?.senses) {
			return;
		}

		Object.entries(data.flags.obsidian.attributes.senses).forEach(([key, sense]) =>
			data.system.attributes.senses[CONVERT.senses[key]] = sense.radius);
	}
};
