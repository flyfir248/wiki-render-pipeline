from fyt import titles


def test_typographic_punctuation_emoji_and_hashtags_are_cleaned_out():
    assert titles.clean("Pebble‑for‑sex: Adelie penguin’s stone heist") == "Pebble-for-sex: Adelie penguin's stone heist"
    assert titles.clean("  “The town that burns” \U0001F525 #shorts ") == "The town that burns"
    assert titles.clean("It never stopped.") == "It never stopped"
    assert titles.clean("And then...") == "And then..."


def test_the_penguin_short_fails_and_a_plain_question_passes():
    hard, soft = titles.problems("Pebble-for-sex: Adelie penguin's stone heist", short=True, subject="penguins")
    assert any("sex" in p for p in hard)
    assert any("Label" in p for p in soft) and any("hyphenated" in p for p in soft)
    assert titles.problems("Why do penguins pay for mates in pebbles?", short=True, subject="penguins") == ([], [])


def test_length_caps_and_acronyms():
    assert titles.problems("x" * 56, short=True)[0] and not titles.problems("Why " + "x" * 51, short=True)[0]
    assert not titles.problems("x" * 70, short=False)[0] and titles.problems("x" * 71, short=False)[0]
    assert titles.problems("Too short", short=True)[0]
    assert not titles.problems("How NASA lost a spacecraft to inches", short=True)[1]
    assert titles.problems("The cat that SURVIVED three sinkings", short=True)[1] == ["ALL CAPS word"]
    assert not titles.problems("The naked mole-rat never gets old", short=True)[0]


def test_the_subject_shows_before_the_phone_cuts_the_title():
    late = "A strange trade that scientists filmed in Antarctica: penguins"
    assert any("isn't named" in p for p in titles.problems(late, short=False, subject="penguins")[1])
    assert not titles.problems("Penguins trade pebbles for mates", short=True, subject="Adelie penguins")[1]


def test_pick_takes_the_first_clean_title_with_fewest_weaknesses():
    best, notes = titles.pick(
        ["Pebble-for-sex: Adelie penguin's stone heist", "Stone heist: penguins at it again", "Why do penguins trade pebbles?"],
        short=True, subject="penguins",
    )
    assert best == "Why do penguins trade pebbles?"
    assert len(notes) == 2
    assert titles.pick(["Sex and the penguin"], short=True) == (None, ['"Sex and the penguin": too short (19 characters), "Sex" limits ads and reach'])
