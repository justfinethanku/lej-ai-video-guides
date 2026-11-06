// Pure narration timing shared by filming and graphics; no config, browser or renderer is loaded.
export const LEAD = 0.5; // seconds of picture before the narration starts
export const TAIL = 0.8; // and after it ends

const norm = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, "");

/** Seconds into the narration for a step's `at`: a number, a word, or the nth time a word is said ("add#2"). */
export function atSeconds(at, words) {
  if (at === undefined || at === null) return null;
  if (typeof at === "number") return at;
  const [w, nth] = String(at).split("#");
  const want = norm(w);
  let seen = 0;
  for (const word of words) {
    if (norm(word.text) === want && ++seen === Number(nth || 1)) return word.start;
  }
  throw new Error(`"${at}" is not said in this beat`);
}

/** Seconds from the start of a beat's clip at which a callout shows and hides. */
export function calloutSpan(c, words, beatSeconds) {
  const start = Math.max(0, LEAD + atSeconds(c.at, words) - 0.15);
  const end = c.until !== undefined && c.until !== null ? LEAD + atSeconds(c.until, words) - 0.05 : beatSeconds - 0.25;
  return { start: +start.toFixed(3), end: +Math.max(start + 0.8, end).toFixed(3) };
}

