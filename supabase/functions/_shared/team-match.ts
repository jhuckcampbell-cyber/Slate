/** Match school/team identity without falling back to a shared mascot. */
const normalize = (name: string) => name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().replace(/^los angeles /, "la ");

export function matchesTeamIdentity(team: Record<string, unknown>, name: string): boolean {
  const ours = normalize(name);
  return !!ours && [team.displayName, team.location, team.abbreviation].some(
    (value) => typeof value === "string" && normalize(value) === ours,
  );
}
