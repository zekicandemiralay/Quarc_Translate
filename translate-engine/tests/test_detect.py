import pytest

import detect

SAMPLES = {
    "en": "The quick brown fox jumps over the lazy dog near the river bank.",
    "tr": "Bugün hava çok güzel, parka gidip bir kitap okumak istiyorum.",
    "de": "Ich habe gestern einen langen Spaziergang im Park gemacht und viel gesehen.",
    "fr": "Hier soir, nous avons mangé dans un petit restaurant près de la gare.",
    "es": "Mañana por la mañana tengo que ir al médico y después a trabajar.",
    "it": "Domani mattina devo andare dal dottore e poi al lavoro in ufficio.",
    "pt": "Amanhã de manhã preciso ir ao médico e depois seguir para o trabalho.",
    "nl": "Morgenochtend moet ik naar de dokter en daarna ga ik naar mijn werk.",
    "pl": "Jutro rano muszę iść do lekarza, a potem pojadę do pracy w biurze.",
    "sv": "I morgon bitti måste jag gå till läkaren och sedan åka till jobbet.",
    "ru": "Завтра утром мне нужно сходить к врачу, а потом поехать на работу.",
    "uk": "Завтра вранці мені потрібно піти до лікаря, а потім поїхати на роботу, їй-богу.",
    "ar": "غدا في الصباح يجب علي أن أذهب إلى الطبيب ثم إلى العمل في المكتب.",
    "fa": "فردا صبح باید به دکتر بروم و بعد از آن به محل کار بروم، چون کار دارم.",
    "el": "Αύριο το πρωί πρέπει να πάω στον γιατρό και μετά στη δουλειά.",
    "he": "מחר בבוקר אני צריך ללכת לרופא ואחר כך לעבודה במשרד.",
    "th": "พรุ่งนี้เช้าฉันต้องไปหาหมอแล้วไปทำงานที่สำนักงาน",
    "ko": "내일 아침에 병원에 갔다가 회사에 출근해야 합니다.",
    "ja": "明日の朝は病院に行ってから、会社に出勤しなければなりません。",
    "zh": "明天早上我必须先去看医生，然后再去办公室上班。",
    "hi": "कल सुबह मुझे डॉक्टर के पास जाना है और फिर दफ़्तर जाना है।",
}


@pytest.mark.parametrize("code,text", SAMPLES.items())
def test_detects_every_sample_language(code, text):
    found = detect.detect(text)
    assert found["language"] == code, found
    assert found["confidence"] > 0.6, found


def test_azerbaijani_and_turkish_are_told_apart():
    assert detect.detect("Sabah həkimə getməliyəm, sonra isə işə gedəcəyəm, çünki işim çoxdur.")["language"] == "az"
    assert detect.detect("Sabah doktora gitmem lazım, sonra da işe gideceğim, çünkü işim çok.")["language"] == "tr"


def test_script_rules_are_certain_without_statistics():
    for text, code in [("Γειά σου κόσμε", "el"), ("שלום עולם", "he"), ("สวัสดีชาวโลก", "th"), ("안녕하세요", "ko"), ("こんにちは世界", "ja"), ("你好世界", "zh")]:
        found = detect.detect(text)
        assert found["language"] == code
        assert found["confidence"] > 0.9


def test_japanese_with_kanji_is_not_mistaken_for_chinese():
    assert detect.detect("私は昨日、友達と一緒に東京へ行きました。")["language"] == "ja"


def test_short_text_is_never_claimed_with_confidence():
    for word in ["Hotel", "Taxi", "ok", "Merhaba"]:
        assert detect.detect(word)["confidence"] < 0.6, word


def test_numbers_links_and_emoji_carry_no_language():
    for text in ["12345 67.89", "https://example.com/a/b", "a@b.com", "😀😀", ""]:
        found = detect.detect(text)
        assert found["confidence"] == 0.0, text


def test_links_inside_a_sentence_do_not_confuse_it():
    text = "Lütfen https://www.example.com/the-quick-brown-fox adresini ziyaret edin ve bize yazın."
    assert detect.detect(text)["language"] == "tr"


def test_returns_ranked_candidates():
    found = detect.detect(SAMPLES["de"])
    assert found["candidates"][0]["language"] == "de"
    assert len(found["candidates"]) <= 3
    assert found["candidates"] == sorted(found["candidates"], key=lambda c: -c["confidence"])
