const TEAM_NAME_VARIANTS: Record<string, string[]> = {
	"Newcastle United": ["Newcastle Utd"],
	"Nottingham Forest": ["Nott'ham Forest"],
	"Tottenham Hotspur": ["Tottenham"],
	"West Ham United": ["West Ham"],
	"Manchester United": ["Manchester Utd"]
};

export const teamNameOptions = (name: string) => {
	const variants = TEAM_NAME_VARIANTS[name] ?? [];
	return Array.from(new Set([name, ...variants]));
};
