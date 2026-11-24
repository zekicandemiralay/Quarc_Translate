"""Everything that happens to text before and after the model sees it.

Translation models are trained on single sentences. Feeding them a whole
pasted email is what made the old engine lose paragraph breaks, glue bullet
lists into one line and drop the end of long inputs. So the text is taken apart
into lines → sentences, only the sentences go to the model, and the exact
layout (blank lines, indentation, bullets, trailing spaces) is put back around
the translations afterwards.

Also here: protection of things a model must copy, not translate (URLs, email
addresses, @handles, `code`) — measured with the real models, which otherwise
turn `support@example.com` into `Destek@example.com` — and ALL CAPS handling.
"""

import re
from dataclasses import dataclass, field

MAX_CHUNK_CHARS = 420

# ── lines ────────────────────────────────────────────────────────────────────

_BULLET = r"(?:[-*+•·▪◦‣–—]|\[[ xX]?\]|\(?[a-zA-Z]\))"
_NUMBER = r"\(?\d{1,2}[.)]"
_LINE = re.compile(
    rf"^(?P<indent>[ \t]*)(?P<marker>(?:{_BULLET}|{_NUMBER})[ \t]+)?(?P<body>.*?)(?P<trail>[ \t]*)$"
)
_BULLET_ONLY = re.compile(rf"^(?P<indent>[ \t]*)(?P<marker>{_BULLET}[ \t]+)?(?P<body>.*?)(?P<trail>[ \t]*)$")
_NUMBERED_LINE = re.compile(r"^[ \t]*\(?\d{1,2}[.)][ \t]+\S")


@dataclass
class Line:
    indent: str = ""
    marker: str = ""
    body: str = ""
    trail: str = ""
    # filled in later: indexes into the unit list for this line's sentences
    units: list = field(default_factory=list)


def parse_lines(text):
    """Splits text into lines, keeping indentation, list markers and trailing spaces.

    "3. Haziran'da yağmur yağdı" is a date, not a list item, so a number only
    counts as a list marker when at least two lines of the text are numbered.
    """
    raw = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    numbered = sum(1 for line in raw if _NUMBERED_LINE.match(line)) >= 2
    pattern = _LINE if numbered else _BULLET_ONLY
    lines = []
    for raw_line in raw:
        m = pattern.match(raw_line)
        lines.append(Line(m.group("indent"), m.group("marker") or "", m.group("body"), m.group("trail")))
    return lines


# ── sentences ────────────────────────────────────────────────────────────────

# Words after which a full stop does NOT end the sentence (all lower case, no dot).
_ABBREVIATIONS = set(
    """
    mr mrs ms dr prof sr jr st mt vs etc fig figs vol vols no nos dept est inc ltd co corp approx cf al ed eds ca ex
    mon tue tues wed thu thur thurs fri sat sun jan feb mar apr jun jul aug sep sept oct nov dec
    gen col lt sgt capt rev hon gov pres sen rep
    bzw ggf usw vgl nr str hr fr dipl ing mio mrd sog evtl inkl zzgl
    sn bkz vb yrd doç müh av alb cad sok mah mü uzm arş
    mme mlle mm sra srta av dña
    """.split()
)
_TERMINATORS = ".!?…"
_CLOSERS = "\"'”’»)]}"
_CJK_ENDERS = "。！？؟"
_TOKEN_BEFORE = re.compile(r"(\S+)$")


def _ends_with_abbreviation(prefix):
    m = _TOKEN_BEFORE.search(prefix)
    if not m:
        return False
    token = m.group(1).strip("\"'“”‘’([{«").rstrip(".")
    if not token:
        return False
    low = token.lower()
    if low in _ABBREVIATIONS:
        return True
    if len(token) == 1 and token.isalpha():  # an initial: "J. Smith"
        return True
    if "." in token:  # "e.g", "U.S", "z.B"
        return all(len(part) <= 2 for part in token.split("."))
    if token.isdigit():  # "3. Mai" / "3. Haziran": an ordinal or a date, not a sentence end
        return True
    return False


def split_sentences(line):
    """One line of text → sentences. Abbreviations, initials and ordinals don't end one."""
    out = []
    start = 0
    i = 0
    n = len(line)
    while i < n:
        ch = line[i]
        if ch in _CJK_ENDERS:
            j = i + 1
            while j < n and line[j] in _CLOSERS + _CJK_ENDERS:
                j += 1
            out.append(line[start:j])
            start = j
            i = j
            continue
        if ch in _TERMINATORS:
            j = i + 1
            while j < n and (line[j] in _TERMINATORS or line[j] in _CLOSERS):
                j += 1
            if j < n and line[j].isspace():
                rest = line[j:].lstrip()
                prefix = line[start:i]
                run = line[i:j].rstrip(_CLOSERS)
                is_ellipsis = bool(run) and set(run) <= {".", "…"} and (len(run) > 1 or run == "…")
                # "Dr." / "J." / "3." don't end a sentence; neither does "Wait... what?"
                # An ellipsis followed by a capital does ("He left… Then she cried.").
                continues = (is_ellipsis and rest[:1].islower()) or (line[i] == "." and j == i + 1 and _ends_with_abbreviation(prefix))
                if rest and not continues:
                    out.append(line[start:j])
                    start = j
                    i = j
                    continue
            i = j
            continue
        i += 1
    tail = line[start:]
    if tail.strip():
        out.append(tail)
    return [s.strip() for s in out if s.strip()]


def split_long(sentence, limit=MAX_CHUNK_CHARS):
    """A sentence longer than the model handles well is cut at the best nearby break."""
    pieces = []
    rest = sentence.strip()
    while len(rest) > limit:
        window = rest[:limit]
        cut = -1
        for sep in ("; ", ": ", ", ", " – ", " - ", " "):
            idx = window.rfind(sep)
            if idx >= limit * 0.4:
                cut = idx + len(sep.rstrip())
                break
        if cut <= 0:
            cut = limit  # no break at all (CJK): hard cut
        pieces.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        pieces.append(rest)
    return pieces


def sentences_of(body):
    out = []
    for s in split_sentences(body):
        out.extend(split_long(s))
    return out


_NO_SPACE_TARGETS = {"zh", "ja", "th"}


def join_sentences(parts, target):
    return ("" if target in _NO_SPACE_TARGETS else " ").join(parts)


# ── protected spans ──────────────────────────────────────────────────────────

_PROTECT = re.compile(
    r"""
    (?P<url>(?:https?://|www\.)[^\s<>"']*[^\s<>"'.,;:!?)\]}])
  | (?P<email>[\w.+-]+@[\w-]+(?:\.[\w-]+)+)
  | (?P<handle>(?<![\w@])@\w{2,})
  | (?P<code>`[^`\n]+`)
    """,
    re.VERBOSE,
)
# Letters+digit tokens survive translation in both directions (measured on the
# real models); anything wrapped in punctuation — [[0]], <0>, {0} — gets eaten.
_TOKEN = "QZ{}"
_TOKEN_RE = re.compile(r"QZ(\d+)", re.IGNORECASE)


def protect(text):
    """Swaps URLs/emails/@handles/`code` for QZ0, QZ1… → (text, {token: original})."""
    spans = {}

    def swap(m):
        token = _TOKEN.format(len(spans))
        spans[token] = m.group(0)
        return token

    return _PROTECT.sub(swap, text), spans


def restore(text, spans):
    """Puts the originals back. Returns None if the model lost or duplicated one."""
    if not spans:
        return text
    seen = {}
    for m in _TOKEN_RE.finditer(text):
        key = _TOKEN.format(int(m.group(1)))
        seen[key] = seen.get(key, 0) + 1
    if any(seen.get(token, 0) != 1 for token in spans) or any(token not in spans for token in seen):
        return None
    return _TOKEN_RE.sub(lambda m: spans[_TOKEN.format(int(m.group(1)))], text)


def has_letters_besides_tokens(text):
    return bool(re.search(r"[^\W\d_]", _TOKEN_RE.sub("", text)))


# ── capitals ─────────────────────────────────────────────────────────────────

_TURKIC = {"tr", "az"}


def is_shouting(text):
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 4 and sum(c.isupper() for c in letters) / len(letters) > 0.8


def lower_for(text, lang):
    """Lower-cases ALL CAPS input so the model sees normal sentences (Turkish I/İ aware)."""
    if lang in _TURKIC:
        text = text.replace("I", "ı").replace("İ", "i")
    low = text.lower()
    for i, c in enumerate(low):
        if c.isalpha():
            return low[:i] + (c.upper() if lang not in _TURKIC or c != "i" else "İ") + low[i + 1 :]
    return low


def upper_for(text, lang):
    if lang in _TURKIC:
        text = text.replace("i", "İ").replace("ı", "I")
    return text.upper()


# ── output cleanup ───────────────────────────────────────────────────────────

_SPACE_BEFORE = re.compile(r"\s+([.,](?!\d))")
_MULTI_SPACE = re.compile(r"[ \t]{2,}")


def tidy(text, target):
    """Small repairs to what the model wrote: stray space before . or , and doubled spaces."""
    if target in _NO_SPACE_TARGETS | {"ko"}:
        return text.strip()
    text = _SPACE_BEFORE.sub(r"\1", text)
    return _MULTI_SPACE.sub(" ", text).strip()
