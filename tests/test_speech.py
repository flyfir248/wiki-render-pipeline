import pytest

from fyt.speech import ordinal, speakable, spoken_sentences, year
from fyt.tts import estimate_spoken


@pytest.mark.parametrize(
    "written, spoken",
    [
        ("HAL 9000 was built in 1992.", "Hal nine thousand was built in nineteen ninety-two."),
        ("In 1969, NASA landed.", "In nineteen sixty-nine, Nasa landed."),
        ("The 1990s and the '80s.", "The nineteen nineties and the eighties."),
        ("WWII ended in 1945.", "World War Two ended in nineteen forty-five."),
        ("Dr. Smith lived on St. James St.", "Doctor Smith lived on Saint James Street."),
        ("It rose 3.5% to $4.2 million.", "It rose three point five percent to four point two million dollars."),
        ("The 21st century, 3rd place.", "The twenty-first century, third place."),
        ("Born c. 1450 AD, died 300 BC.", "Born circa fourteen fifty A D, died three hundred B C."),
        ("On March 3, 1921 they met.", "On March third, nineteen twenty-one they met."),
        ("Louis XIV ruled 1643–1715.", "Louis the fourteenth ruled sixteen forty-three to seventeen fifteen."),
        ("about 10,000 km away", "about ten thousand kilometers away"),
        ("The FBI and the IUCN.", "The F B I and the I U C N."),
        ("A 9-year-old (born 2012) ran.", "A nine-year-old, born twenty twelve, ran."),
        ("It was found — once.", "It was found, once."),
        ("He moved to the U.S. Then he left.", "He moved to the U S. Then he left."),
        ("A 35-mph wave, 25 ft. high, near Ft. Knox.", "A thirty-five-mile-per-hour wave, twenty-five feet high, near Fort Knox."),
        ("It flew at 30,000 ft. Then it fell.", "It flew at thirty thousand feet. Then it fell."),
        ("A 15 ft wave hit. Winds of 35 mph hit.", "A fifteen foot wave hit. Winds of thirty-five miles per hour hit."),
        ("Flight MH370, the B-52 and the A380.", "Flight M H three seventy, the B fifty-two and the A three eighty."),
        ("COVID-19 and 9/11.", "Covid nineteen and nine eleven."),
        ("Speeds in MPH and 50 psi.", "Speeds in miles per hour and fifty pounds per square inch."),
    ],
)
def test_speakable(written, spoken):
    assert speakable(written) == spoken


def test_years_and_ordinals():
    assert [year(y) for y in (1905, 1900, 2000, 2008, 2024)] == [
        "nineteen oh five",
        "nineteen hundred",
        "two thousand",
        "two thousand eight",
        "twenty twenty-four",
    ]
    assert [ordinal(n) for n in (1, 2, 12, 20, 33)] == ["first", "second", "twelfth", "twentieth", "thirty-third"]


def test_abbreviations_dont_split_sentences():
    sentences = spoken_sentences("Dr. Smith met Mr. Jones in c. 1450. Then they left.")
    assert [[w for w, _ in s] for s in sentences] == [
        ["Dr.", "Smith", "met", "Mr.", "Jones", "in", "c.", "1450."],
        ["Then", "they", "left."],
    ]


def test_captions_keep_the_written_words_but_time_the_spoken_ones():
    [pairs] = spoken_sentences("In 1992 it hid.")
    words = estimate_spoken(pairs, duration=2.0)
    assert [w.word for w in words] == ["In", "1992", "it", "hid."]
    year_span = words[1].end - words[1].start
    assert year_span > 2 * (words[2].end - words[2].start)  # "nineteen ninety-two" takes longer than "it"
    assert words[-1].end <= 2.0
