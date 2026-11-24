// Cuts a long text into pieces that each go to the server as one request.
//
// The engine translates sentence by sentence anyway; cutting here only keeps a
// single request short (so one slow chunk can't time out the whole text), lets
// the translation appear piece by piece, and means that editing one paragraph
// only re-translates that paragraph.
//
// Contract: joining the pieces back — piece.text + piece.sep, in order — gives
// exactly the original text. Line breaks, blank lines and spacing are never lost.

export const CHUNK_LIMIT = 900;

const ENDERS = /([.!?…]+["'”’)\]»]*|[。！？؟]+["'”’)\]»]*)(\s*)/g;

/** A line longer than the limit → sentence pieces [{ text, ws }], ws = the whitespace that followed. */
function sentencePieces(line) {
  const pieces = [];
  let start = 0;
  for (const m of line.matchAll(ENDERS)) {
    const end = m.index + m[1].length;
    const cjk = /[。！？؟]/.test(m[1][0]);
    if (!cjk && !m[2] && end < line.length) continue; // "3.5", "e.g.x" — not a sentence end
    pieces.push({ text: line.slice(start, end), ws: m[2] });
    start = end + m[2].length;
  }
  if (start < line.length) pieces.push({ text: line.slice(start), ws: '' });
  return pieces;
}

/** Cuts `s` (longer than limit, no sentence ends) at a space near the limit, else hard. */
function hardCut(s, limit) {
  const out = [];
  let rest = s;
  while (rest.length > limit) {
    const at = rest.lastIndexOf(' ', limit);
    const cut = at > limit * 0.4 ? at : limit;
    out.push({ text: rest.slice(0, cut), ws: at > limit * 0.4 ? ' ' : '' });
    rest = rest.slice(cut + (at > limit * 0.4 ? 1 : 0));
  }
  if (rest) out.push({ text: rest, ws: '' });
  return out;
}

/**
 * @returns {{ text: string, sep: string, blank: boolean }[]}
 *   blank = only whitespace: nothing to translate, copy through.
 */
export function splitForRequests(text, limit = CHUNK_LIMIT) {
  if (!text) return [];
  const chunks = [];
  let lines = []; // lines gathered for the chunk being built
  let size = 0;

  const flush = (sep) => {
    if (!lines.length) return;
    const joined = lines.join('\n');
    chunks.push({ text: joined, sep, blank: !joined.trim() });
    lines = [];
    size = 0;
  };

  const all = text.split('\n');
  all.forEach((line, i) => {
    const last = i === all.length - 1;

    if (line.length > limit) {
      flush('\n');
      // A very long line: sentence pieces (a piece that is itself too long is cut at a space),
      // merged while they fit, each merged group one chunk, glued back with the whitespace it had.
      const parts = [];
      for (const piece of sentencePieces(line)) {
        if (piece.text.length <= limit) {
          parts.push(piece);
        } else {
          const cuts = hardCut(piece.text, limit);
          cuts[cuts.length - 1].ws += piece.ws; // keep a space that ended the last cut
          parts.push(...cuts);
        }
      }
      const merged = [];
      for (const p of parts) {
        const prev = merged[merged.length - 1];
        if (prev && prev.text.length + prev.ws.length + p.text.length <= limit) {
          prev.text = prev.text + prev.ws + p.text;
          prev.ws = p.ws;
        } else {
          merged.push({ ...p });
        }
      }
      merged.forEach((p, k) => {
        const closing = k === merged.length - 1;
        chunks.push({ text: p.text, sep: closing ? p.ws + (last ? '' : '\n') : p.ws, blank: !p.text.trim() });
      });
      return;
    }

    if (lines.length && size + line.length + 1 > limit) flush('\n');
    lines.push(line);
    size += line.length + 1;
    if (last) flush('');
  });

  return chunks;
}

/** Puts translated chunks back together the way the original was laid out. */
export function joinChunks(chunks, texts) {
  return chunks.map((c, i) => (texts[i] ?? '') + c.sep).join('');
}
