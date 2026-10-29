"""What makes a title YouTube can recommend: the rules the writers are given, and the checks a title
has to pass before it goes up.

A title is read in three places: under a Short in the feed and in search (about 40 characters show on a
phone), in suggested videos beside a long video (about 60), and by YouTube itself to work out who the
video is for. So it says in everyday words what the video is about, near the start, and gives a stranger a
reason to want the answer. Wordplay, labels and invented compounds ("Pebble-for-sex: Adelie penguin's
stone heist") do neither: nobody searches for them, and they only make sense after watching.
"""

from __future__ import annotations

import re
import unicodedata

SHORT_MAX = 55  # the whole title shows under a Short on most phones up to about here
LONG_MAX = 70  # suggested videos and search cut a long video's title at about 60-70
FRONT = {"short": 40, "long": 50}  # what shows before the cut: the subject is named in here
MIN_CHARS = 20

RULES = """Titles (they decide whether YouTube shows the video to anyone, so they are written for strangers):
- Name the subject in its everyday words near the start ("penguins", "a ship", "a town in Ohio"), the
  words someone would type to find it, within the first {front} characters: that is all a phone shows.
- Then give a stranger a reason to want the answer: the question the video answers, phrased as they
  would wonder it ("Why do penguins steal stones?", "How did a town burn for 60 years?"), or the most
  surprising fact stated plainly ("This town has been on fire since 1962"). Questions work well here.
- {length}
- Plain words a 12-year-old reads at a glance. No puns, wordplay or cute labels ("stone heist"), no
  "Label: subtitle" headline, no invented hyphenated compounds, no jargon or names a stranger doesn't
  know yet, no hashtags, no emoji, no ALL CAPS words, no "you won't believe", no "shocking".
- Advertiser-friendly: never words about sex, nudity, prostitution, suicide, gore or slurs, even when
  the story touches them; say what happens in neutral words ("trade pebbles for mates").
- True to the video: it promises only what the video answers."""


def rules(short: bool) -> str:
    return RULES.format(
        front=FRONT["short" if short else "long"],
        length=(
            f"Short: 30-50 characters (max {SHORT_MAX}), one idea."
            if short
            else f"Long video: 40-65 characters (max {LONG_MAX}); the subject and the stakes or mystery."
        ),
    )


# Typographic punctuation models like to write: it looks the same but breaks search matching, since
# "pebble‑for‑sex" with non-breaking hyphens is not the words someone types.
_ASCII = str.maketrans({
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-", "−": "-",
    "‘": "'", "’": "'", "‛": "'", "′": "'", "“": '"', "”": '"', "‟": '"',
    "…": "...", " ": " ", " ": " ", " ": " ", "​": "",
})

# Words that make YouTube limit ads on a video, or keep it from younger viewers and so from much of the feed.
UNSAFE = re.compile(
    r"\b(sex(ual(ly)?)?|sexy|porn\w*|prostitut\w*|hooker\w*|brothel\w*|nude\w*|orgy|orgies|incest\w*|"
    r"rape[ds]?|raping|suicid\w*|gore|gory|decapitat\w*|dismember\w*|beheading\w*)\b",
    re.I,
)
_LABEL = re.compile(r"^[^:?!.]{2,32}:\s")  # "Pebble-for-sex: ..."
_HASHTAG = re.compile(r"(^|\s)#\w+")


def clean(title: str) -> str:
    """The title in plain characters: straight quotes and hyphens, no emoji, hashtags or stray spaces."""
    t = unicodedata.normalize("NFKC", title or "").translate(_ASCII)
    t = "".join(c for c in t if unicodedata.category(c) not in ("So", "Cs", "Co", "Cn") and c not in "️‍")
    t = _HASHTAG.sub(" ", t)
    t = re.sub(r"\s+", " ", t).strip().strip('"').strip()
    return t[:-1].rstrip() if t.endswith(".") and not t.endswith("...") else t


def problems(title: str, short: bool, subject: str = "") -> tuple[list[str], list[str]]:
    """What is wrong with a title: (faults that keep it from going up, weaknesses that make it rank lower).
    `subject` is the everyday name of what the video is about, which should show before the cut."""
    hard, soft = [], []
    limit = SHORT_MAX if short else LONG_MAX
    if len(title) < MIN_CHARS:
        hard.append(f"too short ({len(title)} characters)")
    if len(title) > limit:
        hard.append(f"too long ({len(title)} characters, max {limit})")
    if m := UNSAFE.search(title):
        hard.append(f"\"{m.group(0)}\" limits ads and reach")
    if any(w.isupper() for w in re.findall(r"[A-Za-z]{5,}", title)):  # NASA, WWII and USA are fine
        soft.append("ALL CAPS word")
    if _LABEL.match(title):
        soft.append("a \"Label: subtitle\" headline")
    if re.search(r"\b[A-Za-z]+-[A-Za-z]+-[A-Za-z]+\b", title):
        soft.append("an invented hyphenated compound")
    if subject:
        front = title[: FRONT["short" if short else "long"]].lower()
        words = [w for w in re.findall(r"[a-z0-9']+", subject.lower()) if len(w) > 2]
        if words and not any(w.rstrip("s") in front for w in words):
            soft.append(f"\"{subject}\" isn't named in the first {FRONT['short' if short else 'long']} characters")
    return hard, soft


def pick(candidates: list[str], short: bool, subject: str = "") -> tuple[str | None, list[str]]:
    """The first candidate with no faults and the fewest weaknesses (candidates come best first), or None
    and what was wrong with each."""
    best, best_soft, notes, seen = None, 99, [], set()
    for raw in candidates:
        t = clean(raw)
        if not t or t.lower() in seen:
            continue
        seen.add(t.lower())
        hard, soft = problems(t, short, subject)
        if hard:
            notes.append(f"\"{t}\": {', '.join(hard + soft)}")
        elif len(soft) < best_soft:
            best, best_soft = t, len(soft)
            if soft:
                notes.append(f"\"{t}\": {', '.join(soft)}")
        elif soft:
            notes.append(f"\"{t}\": {', '.join(soft)}")
    return best, notes
