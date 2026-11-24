// A translation as tappable pieces. The engine cuts every result into segments:
//   { t: "text", u: null }          layout: line breaks, bullets, spaces
//   { t: "Günaydın!", u: "0:2" }    a translated sentence; units["0:2"] = { src, out, alt }
// Tapping a sentence (u != null and units[u].alt) offers other translations of it, and choosing one
// swaps just that sentence — the layout around it is untouched.

/** Plain-text view of the pieces. */
export const textOf = (segments) => segments.map((s) => s.t).join('');

/**
 * @returns {{ segments, units, text }} with the sentence `id` replaced by `replacement`
 *          (the inputs are not modified).
 */
export function replaceUnit(segments, units, id, replacement) {
  const next = segments.map((s) => (s.u === id ? { ...s, t: replacement } : s));
  return { segments: next, units: { ...units, [id]: { ...units[id], out: replacement } }, text: textOf(next) };
}

/** Can this piece be tapped? */
export const isTappable = (segment, units) => segment.u != null && !!units?.[segment.u]?.alt;

/** How many sentences of the result have alternatives (to decide whether to hint that they can be tapped). */
export const tappableCount = (segments, units) => (segments && units ? segments.filter((s) => isTappable(s, units)).length : 0);

/** Marks which alternative is the one currently shown (ignoring case, spacing and punctuation). */
const key = (s) => s.replace(/[\s\p{P}\p{S}]+/gu, '').toLocaleLowerCase();
export const sameRendering = (a, b) => key(a) === key(b);
