"""Language registry: what the app offers, how each language is spelled for the
general model (FLORES-200 codes like `tur_Latn`), and which writing systems it
uses (language detection narrows its guess by script first).

Adding a language = one row here. Whether it is *good* depends on `routes.py`:
languages with a dedicated model are excellent, the rest go through NLLB.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Language:
    code: str  # ISO 639-1 (what the app speaks)
    name: str  # in the language itself
    name_en: str
    nllb: str  # FLORES-200 code the general model expects
    scripts: tuple  # writing systems it is normally written in
    rtl: bool = False


L = Language
_ROWS = [
    L("en", "English", "English", "eng_Latn", ("latin",)),
    L("tr", "Türkçe", "Turkish", "tur_Latn", ("latin",)),
    L("de", "Deutsch", "German", "deu_Latn", ("latin",)),
    L("fr", "Français", "French", "fra_Latn", ("latin",)),
    L("es", "Español", "Spanish", "spa_Latn", ("latin",)),
    L("it", "Italiano", "Italian", "ita_Latn", ("latin",)),
    L("pt", "Português", "Portuguese", "por_Latn", ("latin",)),
    L("ru", "Русский", "Russian", "rus_Cyrl", ("cyrillic",)),
    L("ar", "العربية", "Arabic", "arb_Arab", ("arabic",), rtl=True),
    L("zh", "中文", "Chinese", "zho_Hans", ("han",)),
    L("ja", "日本語", "Japanese", "jpn_Jpan", ("han", "kana")),
    L("ko", "한국어", "Korean", "kor_Hang", ("hangul",)),
    L("nl", "Nederlands", "Dutch", "nld_Latn", ("latin",)),
    L("pl", "Polski", "Polish", "pol_Latn", ("latin",)),
    L("sv", "Svenska", "Swedish", "swe_Latn", ("latin",)),
    L("el", "Ελληνικά", "Greek", "ell_Grek", ("greek",)),
    L("hi", "हिन्दी", "Hindi", "hin_Deva", ("devanagari",)),
    L("id", "Bahasa Indonesia", "Indonesian", "ind_Latn", ("latin",)),
    L("vi", "Tiếng Việt", "Vietnamese", "vie_Latn", ("latin",)),
    L("uk", "Українська", "Ukrainian", "ukr_Cyrl", ("cyrillic",)),
    L("cs", "Čeština", "Czech", "ces_Latn", ("latin",)),
    L("fi", "Suomi", "Finnish", "fin_Latn", ("latin",)),
    L("da", "Dansk", "Danish", "dan_Latn", ("latin",)),
    L("ro", "Română", "Romanian", "ron_Latn", ("latin",)),
    L("hu", "Magyar", "Hungarian", "hun_Latn", ("latin",)),
    L("bg", "Български", "Bulgarian", "bul_Cyrl", ("cyrillic",)),
    L("sk", "Slovenčina", "Slovak", "slk_Latn", ("latin",)),
    L("fa", "فارسی", "Persian", "pes_Arab", ("arabic",), rtl=True),
    L("he", "עברית", "Hebrew", "heb_Hebr", ("hebrew",), rtl=True),
    L("az", "Azərbaycan", "Azerbaijani", "azj_Latn", ("latin",)),
    L("no", "Norsk", "Norwegian", "nob_Latn", ("latin",)),
    L("th", "ไทย", "Thai", "tha_Thai", ("thai",)),
    L("ca", "Català", "Catalan", "cat_Latn", ("latin",)),
    L("hr", "Hrvatski", "Croatian", "hrv_Latn", ("latin",)),
    L("sr", "Српски", "Serbian", "srp_Cyrl", ("cyrillic", "latin")),
    L("sl", "Slovenščina", "Slovenian", "slv_Latn", ("latin",)),
    L("et", "Eesti", "Estonian", "est_Latn", ("latin",)),
    L("lv", "Latviešu", "Latvian", "lvs_Latn", ("latin",)),
    L("lt", "Lietuvių", "Lithuanian", "lit_Latn", ("latin",)),
    L("ms", "Bahasa Melayu", "Malay", "zsm_Latn", ("latin",)),
    L("bn", "বাংলা", "Bengali", "ben_Beng", ("bengali",)),
    L("ur", "اردو", "Urdu", "urd_Arab", ("arabic",), rtl=True),
    L("sq", "Shqip", "Albanian", "als_Latn", ("latin",)),
    L("is", "Íslenska", "Icelandic", "isl_Latn", ("latin",)),
    L("af", "Afrikaans", "Afrikaans", "afr_Latn", ("latin",)),
    L("ka", "ქართული", "Georgian", "kat_Geor", ("georgian",)),
    L("hy", "Հայերեն", "Armenian", "hye_Armn", ("armenian",)),
    L("kk", "Қазақша", "Kazakh", "kaz_Cyrl", ("cyrillic",)),
    L("mk", "Македонски", "Macedonian", "mkd_Cyrl", ("cyrillic",)),
    L("be", "Беларуская", "Belarusian", "bel_Cyrl", ("cyrillic",)),
    L("sw", "Kiswahili", "Swahili", "swh_Latn", ("latin",)),
    L("ta", "தமிழ்", "Tamil", "tam_Taml", ("tamil",)),
    L("te", "తెలుగు", "Telugu", "tel_Telu", ("telugu",)),
    L("ml", "മലയാളം", "Malayalam", "mal_Mlym", ("malayalam",)),
    L("mr", "मराठी", "Marathi", "mar_Deva", ("devanagari",)),
    L("gu", "ગુજરાતી", "Gujarati", "guj_Gujr", ("gujarati",)),
]

LANGUAGES = {lang.code: lang for lang in _ROWS}

# What other systems call the same language (detectors, browsers, old clients).
ALIASES = {"nb": "no", "nn": "no", "iw": "he", "in": "id", "jw": "id", "zh-cn": "zh", "zh-tw": "zh", "zh-hans": "zh", "zh-hant": "zh"}


def normalize(code):
    """'EN', 'en-US', 'nb' → the registry code, or None when it is not offered."""
    if not code or not isinstance(code, str):
        return None
    c = code.strip().lower().replace("_", "-")
    if c in LANGUAGES:
        return c
    if c in ALIASES:
        return ALIASES[c]
    base = c.split("-")[0]
    if base in LANGUAGES:
        return base
    return ALIASES.get(base)


def is_supported(code):
    return normalize(code) is not None


def get(code):
    n = normalize(code)
    return LANGUAGES[n] if n else None


def nllb_code(code):
    lang = get(code)
    if not lang:
        raise KeyError(f"unsupported language: {code}")
    return lang.nllb


def language_list():
    """Payload of GET /languages: what the app shows in its pickers."""
    return [
        {"code": l.code, "name": l.name, "nameEn": l.name_en, "rtl": l.rtl}
        for l in LANGUAGES.values()
    ]


def with_script(script):
    return [l.code for l in LANGUAGES.values() if script in l.scripts]
