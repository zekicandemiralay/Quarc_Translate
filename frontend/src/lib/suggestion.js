// How a "Did you mean…" suggestion is shown. The engine sends the whole corrected text, the same text cut
// into pieces with the changed words marked, and the list of changes.

const INLINE_LIMIT = 160; // characters: short texts are shown corrected in full, long ones as a list of changes

/**
 * @returns {{ mode: 'text', pieces: {t, changed}[] } | { mode: 'changes', shown: {from, to}[], more: number }}
 */
export function describeSuggestion(suggestion) {
  if (suggestion.text.length <= INLINE_LIMIT) return { mode: 'text', pieces: suggestion.segments };
  const shown = suggestion.changes.slice(0, 4);
  return { mode: 'changes', shown, more: Math.max(0, suggestion.count - shown.length) };
}

/** A suggestion is only worth showing while it still describes the text in the box. */
export const stillApplies = (suggestion, currentText) => !!suggestion && suggestion.forText === currentText && suggestion.dismissed !== true;
