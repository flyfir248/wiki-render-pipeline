"""Rewrite narration into the words a voice should actually say.

Kokoro (and espeak) phonemize raw text with espeak-ng, which reads "1992" as
"nineteen hundred ninety two", "1990s" as "...ninety z", "HAL" as "H-A-L",
"3.5%" with a full stop in the middle and "Dr." as the end of a sentence.
`spoken_tokens` maps every written token to what should be said for it, so the
voice hears plain words while captions keep showing the text as written.
"""

from __future__ import annotations

import re

ONES = (
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
    "fifteen sixteen seventeen eighteen nineteen"
).split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
SCALES = [(10**12, "trillion"), (10**9, "billion"), (10**6, "million"), (1000, "thousand")]
ORDINAL_WORDS = {
    "one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth",
    "nine": "ninth", "twelve": "twelfth",
}  # fmt: skip


def cardinal(n: int) -> str:
    if n < 0:
        return "minus " + cardinal(-n)
    if n < 20:
        return ONES[n]
    if n < 100:
        t, o = divmod(n, 10)
        return TENS[t] + (f"-{ONES[o]}" if o else "")
    if n < 1000:
        h, r = divmod(n, 100)
        return f"{ONES[h]} hundred" + (f" {cardinal(r)}" if r else "")
    for size, name in SCALES:
        if n >= size:
            q, r = divmod(n, size)
            return f"{cardinal(q)} {name}" + (f" {cardinal(r)}" if r else "")
    return str(n)


def ordinal(n: int) -> str:
    words = cardinal(n)
    head, sep, last = words.rpartition(" " if " " in words and "-" not in words.split(" ")[-1] else "-")
    if not sep:
        head, last = "", words
    if last in ORDINAL_WORDS:
        last = ORDINAL_WORDS[last]
    elif last.endswith("y"):
        last = last[:-1] + "ieth"
    else:
        last += "th"
    return head + sep + last


def year(n: int) -> str:
    """How a year is said: 1992 "nineteen ninety-two", 1905 "nineteen oh five", 2008 "two thousand eight"."""
    if n < 1000 or n >= 10000:
        return cardinal(n)
    hi, lo = divmod(n, 100)
    if 2000 <= n < 2010 or n % 1000 == 0:
        return cardinal(n)
    if lo == 0:
        return f"{cardinal(hi)} hundred"
    if lo < 10:
        return f"{cardinal(hi)} oh {ONES[lo]}"
    return f"{cardinal(hi)} {cardinal(lo)}"


def plural(words: str) -> str:
    """'nineteen ninety' -> 'nineteen nineties', 'eighteen hundred' -> 'eighteen hundreds'."""
    if words.endswith("y"):
        return words[:-1] + "ies"
    if words.endswith("x"):
        return words + "es"
    return words + "s"


def decimal(s: str) -> str:
    whole, _, frac = s.replace(",", "").partition(".")
    out = cardinal(int(whole or 0))
    if frac:
        out += " point " + " ".join(ONES[int(d)] for d in frac)
    return out


MONTHS = {
    "january", "february", "march", "april", "may", "june", "july", "august", "september",
    "october", "november", "december", "jan.", "feb.", "mar.", "apr.", "jun.", "jul.", "aug.",
    "sep.", "sept.", "oct.", "nov.", "dec.",
}  # fmt: skip
YEAR_CUES = {"in", "since", "by", "until", "till", "from", "of", "year", "around", "circa", "c.", "ca.", "before", "after", "during", "between", "and", "to", "early", "late", "mid", "summer", "winter", "spring", "autumn", "fall"}  # fmt: skip
ERAS = {"ad": "A D", "bc": "B C", "bce": "B C E", "ce": "C E"}

# Acronyms said as a word, not letter by letter. Anything else in capitals is spelled out.
WORD_ACRONYMS = {
    "HAL": "Hal", "NASA": "Nasa", "NATO": "Nato", "UNESCO": "Unesco", "UNICEF": "Unicef",
    "OPEC": "Opec", "FIFA": "Fifa", "NAFTA": "Nafta", "LASER": "laser", "RADAR": "radar",
    "SONAR": "sonar", "SCUBA": "scuba", "AIDS": "aids", "SWAT": "swat", "ASCII": "askee",
    "GIF": "gif", "JPEG": "jay peg", "WHO": "W H O", "UFO": "U F O", "DARPA": "Darpa",
    "ESA": "Esa", "INTERPOL": "Interpol", "UEFA": "Uefa", "SARS": "Sars", "COVID": "Covid",
    "ENIAC": "Eniac", "NORAD": "Norad", "OSHA": "Osha", "FEMA": "Fema", "ISIS": "Isis",
    "PIN": "pin", "RAM": "ram", "ROM": "rom", "LEGO": "Lego", "IKEA": "Ikea", "CERN": "Cern",
    "MASH": "mash", "POTUS": "Potus", "NIMBY": "nimby", "YOLO": "yolo", "TASER": "taser",
    "WWI": "World War One", "WWII": "World War Two", "WW1": "World War One", "WW2": "World War Two",
    "USSR": "U S S R", "AI": "A I", "DNA": "D N A", "TV": "T V", "OK": "okay", "NOAA": "Noah", "SETI": "Setty", "MIT": "M I T", "SOS": "S O S",
}  # fmt: skip

ABBREVIATIONS = {
    "dr.": "Doctor", "mr.": "Mister", "mrs.": "Missus", "ms.": "Miz", "prof.": "Professor",
    "mt.": "Mount", "ft.": "Fort", "gen.": "General", "col.": "Colonel", "capt.": "Captain",
    "lt.": "Lieutenant", "sgt.": "Sergeant", "gov.": "Governor", "sen.": "Senator", "rev.": "Reverend",
    "st.": "Street", "jr.": "Junior", "sr.": "Senior", "vs.": "versus", "vs": "versus", "approx.": "approximately",
    "e.g.": "for example", "i.e.": "that is", "etc.": "et cetera", "c.": "circa", "ca.": "circa",
    "no.": "number", "u.s.": "U S", "u.k.": "U K", "u.s.a.": "U S A", "u.n.": "U N", "d.c.": "D C",
    "a.m.": "A M", "p.m.": "P M",
}  # fmt: skip

BEFORE_NAMES = {"dr.", "mr.", "mrs.", "ms.", "prof.", "mt.", "ft.", "gen.", "col.", "capt.", "lt.", "sgt.", "gov.", "sen.", "rev.", "c.", "ca.", "no.", "vs.", "vs", "st."}  # fmt: skip

UNITS = {
    "km": "kilometers", "m": "meters", "cm": "centimeters", "mm": "millimeters", "kg": "kilograms",
    "g": "grams", "mg": "milligrams", "lb": "pounds", "lbs": "pounds", "oz": "ounces", "ft": "feet",
    "mi": "miles", "mph": "miles per hour", "km/h": "kilometers per hour", "kph": "kilometers per hour",
    "°c": "degrees Celsius", "°f": "degrees Fahrenheit", "°": "degrees", "hz": "hertz", "kw": "kilowatts",
    "mw": "megawatts", "gb": "gigabytes", "mb": "megabytes", "tb": "terabytes", "l": "liters", "ml": "milliliters",
    "psi": "pounds per square inch", "kpa": "kilopascals", "mpg": "miles per gallon", "kn": "knots", "kt": "knots",
    "kts": "knots", "yd": "yards", "yds": "yards", "gal": "gallons", "ha": "hectares", "kwh": "kilowatt hours",
    "m/s": "meters per second", "ft/s": "feet per second", "sq": "square",
}
# Units read in full even without a figure in front ("top speed in MPH").
NAMED_UNITS = {"mph": "miles per hour", "kph": "kilometers per hour", "km/h": "kilometers per hour", "psi": "pounds per square inch", "mpg": "miles per gallon", "kwh": "kilowatt hours"}  # fmt: skip
MAGNITUDES = {"k": "thousand", "m": "million", "bn": "billion", "b": "billion", "t": "trillion"}
CURRENCY = {"$": "dollars", "£": "pounds", "€": "euros", "¥": "yen"}
BIG_WORDS = {"thousand", "million", "billion", "trillion"}
ROMAN = re.compile(r"^(?=[MDCLXVI])M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$")
ROMAN_VALUES = {"M": 1000, "D": 500, "C": 100, "L": 50, "X": 10, "V": 5, "I": 1}

SYMBOLS = {"&": "and", "+": "plus", "~": "about", "=": "equals", "×": "times", "—": ",", "–": ",", "-": ",", "--": ","}
LEAD = "\"'“‘([{¿¡"
TRAIL = "\"'”’)]}.,;:!?…"
NUMBER = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"
NUM_RE = re.compile(rf"^({NUMBER})$")
RANGE_RE = re.compile(rf"^({NUMBER})[–—-]({NUMBER})$")
ORDINAL_RE = re.compile(r"^(\d+)(st|nd|rd|th)$", re.I)
DECADE_RE = re.compile(r"^(?:'|’)?(\d{2}|\d{4})'?s$")
MONEY_RE = re.compile(rf"^([$£€¥])({NUMBER})(k|m|bn|b|t)?$", re.I)
UNIT_RE = re.compile(rf"^({NUMBER})([a-zA-Z°/]+)$")
PERCENT_RE = re.compile(rf"^({NUMBER})%$")
COMPOUND_RE = re.compile(r"^(\d+)-([a-zA-Z].*)$")  # 9-year-old
TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")


def _roman(s: str) -> int:
    total = 0
    for a, b in zip(s, s[1:] + " "):
        v = ROMAN_VALUES[a]
        total += -v if b != " " and ROMAN_VALUES[b] > v else v
    return total


def _is_year(n: int, raw: str, prev: str, nxt: str) -> bool:
    if "," in raw or "." in raw or not 1000 <= n <= 2099:
        return False
    if nxt.lower().strip(".,") in ERAS or prev.lower() in YEAR_CUES or prev[:1].isupper() and prev.lower().rstrip(".,") in MONTHS:
        return True
    # A bare four-digit number in the usual range is almost always a year in these scripts,
    # and "fifteen hundred" reads fine even when it is a count.
    return 1100 <= n <= 2099 and not nxt.lower().startswith(tuple(BIG_WORDS))


def _model_number(n: int) -> str:
    hi, lo = divmod(n, 100)
    if lo == 0:
        return f"{ONES[hi]} hundred"
    return f"{ONES[hi]} " + (f"oh {ONES[lo]}" if lo < 10 else cardinal(lo))


def _number(raw: str, prev: str, nxt: str) -> str:
    plain = raw.replace(",", "")
    if "." in plain:
        return decimal(raw)
    n = int(plain)
    if _is_year(n, raw, prev, nxt):
        return year(n)
    if prev[:1].isupper() and prev.lower().rstrip(".,") in MONTHS and 1 <= n <= 31 and "," not in raw:
        return ordinal(n)
    if 100 <= n <= 999 and prev.isupper() and len(prev) > 1:
        return _model_number(n)  # IBM 704 -> "seven oh four", but HAL 9000 stays "nine thousand"
    if len(plain) > 1 and plain.startswith("0"):
        return " ".join(ONES[int(d)] for d in plain)  # 007, phone-like codes
    return cardinal(n)


def _core(core: str, prev: str, nxt: str, prev_raw: str) -> str | None:
    """What to say for one token stripped of surrounding punctuation, or None to keep it."""
    low = core.lower()
    if m := NUM_RE.match(core):
        return _number(m[1], prev, nxt)
    if m := RANGE_RE.match(core):
        a, b = m[1], m[2]
        first = _number(a, prev, nxt)
        second = _number(b, "in" if _is_year(int(float(a.replace(",", ""))), a, prev, b) else prev, nxt)
        return f"{first} to {second}"
    if m := ORDINAL_RE.match(core):
        return ordinal(int(m[1]))
    if m := DECADE_RE.match(core):
        digits = m[1]
        if len(digits) == 2:
            return plural(cardinal(int(digits)))
        return plural(year(int(digits)))
    if m := MONEY_RE.match(core):
        amount = decimal(m[2]) if "." in m[2] else cardinal(int(m[2].replace(",", "")))
        unit = CURRENCY[m[1]]
        if m[3]:
            return f"{amount} {MAGNITUDES[m[3].lower()]} {unit}"
        if nxt.lower() in BIG_WORDS:
            return amount  # "$4.2 million" -> the currency goes after "million"
        if amount == "one":
            unit = {"dollars": "dollar", "pounds": "pound", "euros": "euro"}.get(unit, unit)
        return f"{amount} {unit}"
    if m := PERCENT_RE.match(core):
        return f"{decimal(m[1])} percent"
    if m := UNIT_RE.match(core):
        unit = m[2].lower()
        if unit in UNITS:
            return f"{decimal(m[1])} {UNITS[unit]}"
        if unit in MAGNITUDES:
            return f"{decimal(m[1])} {MAGNITUDES[unit]}"
        if unit in ERAS and len(m[1]) <= 4:
            return f"{year(int(m[1]))} {ERAS[unit]}"
    if m := COMPOUND_RE.match(core):
        if m[2].lower() in UNITS:  # a 35-mph wave
            return f"{cardinal(int(m[1]))} {UNITS[m[2].lower()]}"
        return f"{cardinal(int(m[1]))}-{m[2]}"
    if low in UNITS and prev_raw and NUM_RE.match(prev_raw.strip(TRAIL)):
        return UNITS[low]
    if low in NAMED_UNITS:
        return NAMED_UNITS[low]
    if low in ERAS and core.isupper() and NUM_RE.match(prev_raw.strip(TRAIL) or "x"):
        return ERAS[low]
    if core in WORD_ACRONYMS:
        return WORD_ACRONYMS[core]
    if ROMAN.match(core) and len(core) > 1 and prev[:1].isupper() and prev.isalpha():
        # Henry VIII -> "Henry the eighth"; World War II -> "World War two".
        n = _roman(core)
        if prev.lower() in {"war", "chapter", "part", "act", "volume", "phase", "apollo", "type", "super"}:
            return cardinal(n)
        return f"the {ordinal(n)}"
    if m := TIME_RE.match(core):
        h, mins = int(m[1]), int(m[2])
        return cardinal(h) + ("" if mins == 0 else f" oh {ONES[mins]}" if mins < 10 else f" {cardinal(mins)}")
    if 2 <= len(core) <= 4 and core.isupper() and core.isalpha():
        # Short acronyms are spelled out (IUCN, IRA): espeak would read some as words.
        # Longer capitals are left to espeak, which says NEVER or UNHCR sensibly.
        return " ".join(core)
    if re.fullmatch(r"(?:[A-Z]\.){2,}", core):
        return " ".join(core.replace(".", ""))
    return None


def spoken_tokens(text: str) -> list[tuple[str, str]]:
    """(written token, spoken text) for every whitespace-separated token of `text`."""
    tokens = text.split()
    out: list[tuple[str, str]] = []
    for i, tok in enumerate(tokens):
        prev_raw = tokens[i - 1] if i else ""
        prev = prev_raw.lower() if prev_raw.lower() in ABBREVIATIONS else prev_raw.strip(LEAD + TRAIL)
        nxt = tokens[i + 1].strip(LEAD + TRAIL) if i + 1 < len(tokens) else ""
        if tok in SYMBOLS:
            out.append((tok, SYMBOLS[tok]))
            continue
        lead = tok[: len(tok) - len(tok.lstrip(LEAD))]
        body = tok[len(lead) :]
        # Quotes aren't heard; an opening bracket is a pause.
        pre = ", " if "(" in lead or "[" in lead else ""
        low = body.lower().rstrip(",;:)]\"'”’")
        if re.fullmatch(r"[A-Z]\.", body) and prev[:1].isupper() and nxt[:1].isupper():
            out.append((tok, body[0]))  # a middle initial: Arthur C. Clarke
            continue
        if low in {"c.", "ca.", "no."} and not nxt[:1].isdigit():
            low = ""  # "circa" and "number" only before a figure; "he said no." stays no
        if low in ABBREVIATIONS:
            said = ABBREVIATIONS[low]
            if low == "st.":
                said = "Saint" if nxt[:1].isupper() else "Street"
            if low == "ft." and NUM_RE.match(prev_raw.strip(LEAD + TRAIL)):
                said = "feet"  # 25 ft. -> feet; Ft. Knox -> Fort
            rest = body[len(low) :].replace(")", ",").replace("]", ",")
            if (low not in BEFORE_NAMES or said == "Street") and not rest and (not nxt or nxt[:1].isupper()):
                rest = "."  # "... in the U.S. Then" ends a sentence; "Dr. Smith" doesn't
            out.append((tok, pre + said + rest))
            continue
        core = body.rstrip(TRAIL)
        trail = body[len(core) :]
        said = _core(core, prev, nxt, prev_raw) if core else None
        if said is None:
            said = core.replace("—", ", ").replace("&", " and ")
            said = re.sub(r"(?<=\w)–(?=\w)", " to " if re.search(r"\d–\d", core) else ", ", said)
        if MONEY_RE.match(prev_raw.strip(LEAD + TRAIL)) and core.lower() in BIG_WORDS:
            said += " " + CURRENCY[prev_raw.strip(LEAD)[0]]  # "$4.2 million" -> "... million dollars"
        trail = re.sub(r"[)\]]", ",", trail).translate(str.maketrans("", "", "\"'”’"))
        out.append((tok, pre + said + trail))
    return out


def join_spoken(pairs: list[tuple[str, str]]) -> str:
    return re.sub(r"\s+,", ",", " ".join(said for _, said in pairs)).strip(" ,")


def speakable(text: str) -> str:
    """The whole text as it should be spoken."""
    return join_spoken(spoken_tokens(text))


SENTENCE_END = re.compile(r"[.!?…][\"'”’)\]]*$")


def spoken_sentences(text: str) -> list[list[tuple[str, str]]]:
    """Group tokens into sentences, splitting only where the spoken text ends a sentence,
    so "Dr. Smith" or "c. 1450" don't break a sentence in two."""
    sentences, cur = [], []
    for written, said in spoken_tokens(text):
        cur.append((written, said))
        if SENTENCE_END.search(said):
            sentences.append(cur)
            cur = []
    if cur:
        sentences.append(cur)
    return sentences
