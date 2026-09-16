"""Language registry.

Two things live here: the list the UI shows, and the mapping from the ISO-639-1
codes the app speaks to the FLORES-200 codes NLLB expects (`tr` -> `tur_Latn`).
"""

# code -> (display name, NLLB FLORES-200 code)
LANGUAGES = {
    "en": ("English", "eng_Latn"),
    "tr": ("Türkçe", "tur_Latn"),
    "de": ("Deutsch", "deu_Latn"),
    "fr": ("Français", "fra_Latn"),
    "es": ("Español", "spa_Latn"),
    "it": ("Italiano", "ita_Latn"),
    "pt": ("Português", "por_Latn"),
    "ru": ("Русский", "rus_Cyrl"),
    "ar": ("العربية", "arb_Arab"),
    "zh": ("中文", "zho_Hans"),
    "ja": ("日本語", "jpn_Jpan"),
    "ko": ("한국어", "kor_Hang"),
    "nl": ("Nederlands", "nld_Latn"),
    "pl": ("Polski", "pol_Latn"),
    "sv": ("Svenska", "swe_Latn"),
    "el": ("Ελληνικά", "ell_Grek"),
    "hi": ("हिन्दी", "hin_Deva"),
    "id": ("Bahasa Indonesia", "ind_Latn"),
    "vi": ("Tiếng Việt", "vie_Latn"),
    "uk": ("Українська", "ukr_Cyrl"),
    "cs": ("Čeština", "ces_Latn"),
    "fi": ("Suomi", "fin_Latn"),
    "da": ("Dansk", "dan_Latn"),
    "ro": ("Română", "ron_Latn"),
    "hu": ("Magyar", "hun_Latn"),
    "bg": ("Български", "bul_Cyrl"),
    "sk": ("Slovenčina", "slk_Latn"),
    "fa": ("فارسی", "pes_Arab"),
    "he": ("עברית", "heb_Hebr"),
    "az": ("Azərbaycan", "azj_Latn"),
    "no": ("Norsk", "nob_Latn"),
    "th": ("ไทย", "tha_Thai"),
}

# Pairs with a dedicated Helsinki OPUS-MT model, which beats NLLB-600M on the
# pair it was trained for. Turkish<->English is the pair this app exists for,
# so it gets the specialist; everything else goes through NLLB.
DEDICATED_MODELS = {
    ("tr", "en"): "Helsinki-NLP/opus-mt-tc-big-tr-en",
    ("en", "tr"): "Helsinki-NLP/opus-mt-tc-big-en-tr",
}

NLLB_MODEL = "facebook/nllb-200-distilled-600M"


def is_supported(code):
    """Check if a language code is supported, with case-insensitive matching."""
    if not code:
        return False
    # Try exact match first
    if code in LANGUAGES:
        return True
    # Try lowercase
    code_lower = code.lower()
    if code_lower in LANGUAGES:
        return True
    # Try 2-character code from longer codes (e.g., "en-US" -> "en")
    if len(code) > 2:
        short_code = code[:2].lower()
        if short_code in LANGUAGES:
            return True
    return False


def nllb_code(code):
    """Get NLLB FLORES-200 code for a language, with case-insensitive matching."""
    # Try exact match first
    if code in LANGUAGES:
        return LANGUAGES[code][1]
    # Try lowercase
    code_lower = code.lower()
    if code_lower in LANGUAGES:
        return LANGUAGES[code_lower][1]
    # Try 2-character code from longer codes
    if len(code) > 2:
        short_code = code[:2].lower()
        if short_code in LANGUAGES:
            return LANGUAGES[short_code][1]
    # Return a default if code is not found (should not happen if validated first)
    return LANGUAGES.get(code, LANGUAGES.get("en", ("English", "eng_Latn"))[1])


def language_list():
    """LibreTranslate-compatible /languages payload."""
    return [
        {"code": code, "name": name, "targets": [c for c in LANGUAGES if c != code]}
        for code, (name, _) in LANGUAGES.items()
    ]
