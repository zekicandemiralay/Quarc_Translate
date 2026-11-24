import textproc as tp


def bodies(text):
    return [(l.indent, l.marker, l.body, l.trail) for l in tp.parse_lines(text)]


# ── lines ─────────────────────────────────────────────────────────────────────


def test_bullets_keep_their_marker_and_indent():
    assert bodies("- Milk\n  * Eggs\n• Bread") == [("", "- ", "Milk", ""), ("  ", "* ", "Eggs", ""), ("", "• ", "Bread", "")]


def test_blank_lines_and_trailing_spaces_survive():
    lines = tp.parse_lines("Hello  \n\n\nWorld")
    assert [l.body for l in lines] == ["Hello", "", "", "World"]
    assert lines[0].trail == "  "


def test_numbered_list_needs_two_numbered_lines():
    assert bodies("1. First\n2. Second") == [("", "1. ", "First", ""), ("", "2. ", "Second", "")]
    # A single "3. Haziran…" is a date, not a list item.
    assert bodies("3. Haziran'da yağmur yağdı") == [("", "", "3. Haziran'da yağmur yağdı", "")]


def test_dash_inside_a_word_or_a_negative_number_is_not_a_bullet():
    assert bodies("-5 degrees")[0][1] == ""
    assert bodies("well-known")[0][1] == ""


def test_windows_and_old_mac_line_endings():
    assert [l.body for l in tp.parse_lines("a\r\nb\rc")] == ["a", "b", "c"]


# ── sentences ─────────────────────────────────────────────────────────────────


def test_splits_on_sentence_ends():
    assert tp.split_sentences("Hello there. How are you? Fine!") == ["Hello there.", "How are you?", "Fine!"]


def test_abbreviations_initials_and_ordinals_do_not_split():
    # "Mon." is a known abbreviation, so this stays one chunk — the safe direction (a model copes with two
    # sentences in one chunk; it does not cope with half a sentence).
    assert tp.split_sentences("Dr. Smith will see you at 3 p.m. on Mon. He is busy.") == [
        "Dr. Smith will see you at 3 p.m. on Mon. He is busy."
    ]
    assert tp.split_sentences("Mr. Brown arrived. He sat down.") == ["Mr. Brown arrived.", "He sat down."]
    assert tp.split_sentences("J. R. Tolkien wrote it.") == ["J. R. Tolkien wrote it."]
    assert tp.split_sentences("Am 3. Mai kam er. Danach ging er.") == ["Am 3. Mai kam er.", "Danach ging er."]
    assert tp.split_sentences("z.B. das Haus. Dann kam er.") == ["z.B. das Haus.", "Dann kam er."]
    assert tp.split_sentences("See Fig. 3 for details.") == ["See Fig. 3 for details."]


def test_ellipsis_followed_by_lowercase_continues_the_sentence():
    assert tp.split_sentences("Wait... what is that?") == ["Wait... what is that?"]
    assert tp.split_sentences("He left… Then she cried.") == ["He left…", "Then she cried."]


def test_quotes_and_closing_brackets_stay_with_their_sentence():
    assert tp.split_sentences('He said "Go." Then he left.') == ['He said "Go."', "Then he left."]
    assert tp.split_sentences("(See above.) Next point.") == ["(See above.)", "Next point."]


def test_cjk_and_arabic_question_marks_need_no_space():
    assert tp.split_sentences("今日は晴れです。明日は雨です。") == ["今日は晴れです。", "明日は雨です。"]
    assert tp.split_sentences("هل تتكلم العربية؟ نعم") == ["هل تتكلم العربية؟", "نعم"]


def test_no_terminator_is_one_sentence():
    assert tp.split_sentences("just words") == ["just words"]
    assert tp.split_sentences("   ") == []


def test_long_sentences_are_cut_at_a_comma_not_mid_word():
    sentence = ("word " * 40).strip() + ", " + ("other " * 60).strip() + "."
    pieces = tp.split_long(sentence, 200)
    assert all(len(p) <= 200 for p in pieces)
    assert "".join(pieces).replace(" ", "") == sentence.replace(" ", "")
    assert not any(p.startswith(("ord", "ther")) for p in pieces)  # never inside a word


def test_unbroken_text_is_hard_cut_as_a_last_resort():
    pieces = tp.split_long("あ" * 1000, 400)
    assert [len(p) for p in pieces] == [400, 400, 200]


def test_join_uses_no_space_for_chinese_and_japanese():
    assert tp.join_sentences(["你好。", "再见。"], "zh") == "你好。再见。"
    assert tp.join_sentences(["Hello.", "Bye."], "en") == "Hello. Bye."


# ── protected spans ───────────────────────────────────────────────────────────


def test_protects_and_restores_urls_emails_handles_and_code():
    text = "Mail support@example.com or see https://www.example.com/help-center?id=42, ask @zeki, run `ls -la`."
    safe, spans = tp.protect(text)
    assert "@" not in safe.replace("QZ", "")
    assert len(spans) == 4
    assert tp.restore(safe, spans) == text


def test_url_does_not_swallow_trailing_punctuation():
    safe, spans = tp.protect("Visit https://example.com/a.")
    assert list(spans.values()) == ["https://example.com/a"]
    assert tp.restore(safe, spans) == "Visit https://example.com/a."


def test_email_is_not_also_matched_as_a_handle():
    safe, spans = tp.protect("write to a.b@c.org")
    assert list(spans.values()) == ["a.b@c.org"]


def test_restore_survives_the_models_habits():
    # Turkish adds suffixes, the model may change the case of the token.
    _safe, spans = tp.protect("Write to me@x.org or visit www.x.org")
    assert spans == {"QZ0": "me@x.org", "QZ1": "www.x.org"}
    assert tp.restore("qz1'e gidin; QZ0'a yazın", spans) == "www.x.org'e gidin; me@x.org'a yazın"
    assert tp.restore("Yazın: QZ0 veya QZ1", spans) == "Yazın: me@x.org veya www.x.org"
    assert tp.restore("Yazın: qz0 veya Qz1", spans) == "Yazın: me@x.org veya www.x.org"


def test_restore_refuses_lost_duplicated_or_invented_tokens():
    spans = {"QZ0": "a@b.co", "QZ1": "https://x.org"}
    assert tp.restore("only QZ0 here", spans) is None  # lost one
    assert tp.restore("QZ0 QZ0 QZ1", spans) is None  # duplicated one
    assert tp.restore("QZ0 QZ1 QZ7", spans) is None  # invented one


def test_nothing_to_protect_is_a_no_op():
    assert tp.protect("plain text") == ("plain text", {})
    assert tp.restore("anything", {}) == "anything"


def test_a_sentence_that_is_only_a_link_has_nothing_to_translate():
    safe, _ = tp.protect("https://example.com/x")
    assert not tp.has_letters_besides_tokens(safe)
    safe, _ = tp.protect("See https://example.com/x")
    assert tp.has_letters_besides_tokens(safe)


# ── capitals ──────────────────────────────────────────────────────────────────


def test_shouting_detection():
    assert tp.is_shouting("WARNING: DO NOT OPEN THE DOOR")
    assert not tp.is_shouting("Hello World")
    assert not tp.is_shouting("OK")  # too short to be shouting
    assert not tp.is_shouting("NASA launched it")


def test_lowercasing_and_uppercasing_follow_turkish_rules():
    assert tp.lower_for("DİKKAT: KAPIYI AÇMAYIN", "tr") == "Dikkat: kapıyı açmayın"
    assert tp.lower_for("WARNING: STOP", "en") == "Warning: stop"
    assert tp.upper_for("dikkat: kapıyı açmayın", "tr") == "DİKKAT: KAPIYI AÇMAYIN"
    assert tp.upper_for("attention: stop", "en") == "ATTENTION: STOP"


# ── clean-up ──────────────────────────────────────────────────────────────────


def test_tidy_removes_stray_spaces_but_keeps_french_spacing_and_decimals():
    assert tp.tidy("Merhaba .", "tr") == "Merhaba."
    assert tp.tidy("Yes , it is  .", "en") == "Yes, it is."
    assert tp.tidy("Il coûte 3 , 5 euros ? Oui !", "fr") == "Il coûte 3, 5 euros ? Oui !"
    assert tp.tidy("Price 3 .5", "en") == "Price 3 .5"
    assert tp.tidy("你好 。", "zh") == "你好 。"
