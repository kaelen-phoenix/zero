/**
 * How the person in charge signs in again to an engine whose session expired, shown in the budget's pause reason.
 * Kept free of runtime imports so src/budget.ts can use it without loading any vendor SDK.
 */
const HINTS: Record<string, string> = {
  claude: "corré `claude` en una terminal y escribí /login",
  codex: "corré `codex login`",
};

/** The sign-in instruction for an engine; undefined for engines zero does not know how to sign in to. */
export function signInHint(engine: string): string | undefined {
  return Object.hasOwn(HINTS, engine) ? HINTS[engine] : undefined;
}
