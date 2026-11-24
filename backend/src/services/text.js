// Text hygiene for what users paste in.
//
// The old version stripped every character in \x00-\x1F — which includes \n,
// \r and \t — so a pasted paragraph arrived as one run-on line and the
// translation lost all its structure. Only characters that can never be part
// of real text are removed here; line breaks and tabs are kept.

// C0 controls except TAB (09), LF (0A), CR (0D); DEL; C1 controls; and the
// Unicode "non-characters" that break JSON/SQLite round trips.
const BAD_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F￾￿]/g;
// Zero-width and bidi formatting marks that paste in from web pages and make
// two identical-looking strings differ (and confuse language detection).
const INVISIBLES = /[​-‍⁠﻿‪-‮⁦-⁩]/g;

/** Cleans text for translation. Keeps the user's line structure. */
function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(BAD_CHARS, '')
    .replace(INVISIBLES, '');
}

/** Length the way the user counts it: characters, not UTF-16 code units. */
function charCount(text) {
  let n = 0;
  for (const _ of text) n++; // eslint-disable-line no-unused-vars
  return n;
}

/** Key for "is this the same text?" — ignores case, spacing and trailing punctuation noise. */
function dedupeKey(text) {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Escapes % _ \ so user search text is matched literally by LIKE ... ESCAPE '\'. */
function likePattern(term) {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

module.exports = { cleanText, charCount, dedupeKey, likePattern };
