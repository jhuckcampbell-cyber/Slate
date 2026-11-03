export const queryKeys = {
  board: (tournamentId: string) => ["board", tournamentId] as const,
  myWagers: (participantId: string) => ["wagers", participantId] as const,
  bankroll: (participantId: string) => ["bankroll", participantId] as const,
};
