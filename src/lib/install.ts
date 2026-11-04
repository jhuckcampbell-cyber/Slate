/** When to suggest installing SquadBets to the home screen. Pure: the component feeds it browser facts. */
export type InstallMode = "none" | "ios" | "prompt";

export function installMode(env: {
  userAgent: string;
  /** Already running as an installed app. */
  standalone: boolean;
  /** The browser fired `beforeinstallprompt` (Chrome/Edge/Android). */
  canPrompt: boolean;
  dismissed: boolean;
}): InstallMode {
  if (env.standalone || env.dismissed) return "none";
  if (env.canPrompt) return "prompt";
  // Only Safari can add to the iPhone home screen; Chrome/Firefox/Edge on iOS identify themselves.
  const iOS = /iPhone|iPad|iPod/.test(env.userAgent);
  const otherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(env.userAgent);
  return iOS && !otherIosBrowser ? "ios" : "none";
}
