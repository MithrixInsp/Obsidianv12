export const v3 = {
	convertHD: function (data) {
		if (data.flags.obsidian.hd) {
			data.system.hitDice = `d${data.flags.obsidian.hd}`;
		}
	}
};
