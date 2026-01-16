const DIACRITICS_FROM =
	"áàâäãåāăąçćčĉďđéèêëēĕėęěíìîïĩīĭįıłńñňóòôöõøōŏőřŕśšşșťțţúùûüũūŭůűųýÿžźż";
const DIACRITICS_TO =
	"aaaaaaaaaccccdd" +
	"eeeeeeeee" +
	"iiiiiiiii" +
	"l" +
	"nnn" +
	"ooooooooo" +
	"rr" +
	"ssss" +
	"ttt" +
	"uuuuuuuuuu" +
	"yy" +
	"zzz";

const unaccentSql = (column: string) =>
	`translate(lower(${column}), '${DIACRITICS_FROM}', '${DIACRITICS_TO}')`;

export const slugSql = (column: string) =>
	`regexp_replace(regexp_replace(${unaccentSql(column)}, '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g')`;
