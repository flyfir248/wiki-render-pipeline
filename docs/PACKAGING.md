# Packaging rules: titles, thumbnails and first frames

These rules apply to every Short and long video from 16 Nov 2026, whether `fyt` writes the title or a person or
Claude session writes it by hand (studio scripts, `04_PIPELINES/shorts`, `post_short.ps1`). `fyt/titles.py`
enforces the parts a program can check. Full reasoning and sources are in the playbook doc in the project.

Why: about 96% of our Shorts views come from the swipe feed, where there is no thumbnail. The first 1-2 seconds
and the title line are what decide a view, and the median Short is watched for only 21% of its length.

## Shorts titles
1. 25-45 characters. Longer titles are hidden behind the Shorts player buttons.
2. One thing a stranger can picture (object, animal, place, famous person) in the first three words.
3. One twist that should not be true: a contradiction, a role reversal, two things that should never meet,
   or an extreme.
4. Numbers only when they make that thing stranger ("A 25-Foot Wave of Molasses Hit Boston"). Never open
   with a big impersonal number ("150,000 laborers...").
5. Title Case, correct grammar, no "Part 1/2", no obscure names or jargon, no emoji or hashtags.
6. True. The first spoken line and the first frame deliver the title's promise within 2 seconds.

Templates:
- The [Impossible Adjective] [Thing]: "The 'Extinct' Insect Hiding on a Rock"
- How Did [Weak Thing] Beat [Strong Thing]?: "How Did Emus Outsmart Soldiers in 1932?"
- [Number + Thing] [Verb] [Other Thing]: "75 lb of Cocaine Killed a 175-lb Bear"
- Why Did [Normal Thing] [Impossible Thing]?: "Why Did Maps Show a Fake Island?"
- The [Most Extreme] [Place] on Earth: "The Loneliest Spot in the Ocean"

Keep about 80% of uploads on these templates and 20% on a new pattern as a test.

## Long-video titles
45-70 characters. A known subject plus the stakes: "[Known Subject]: How [Precise Measure] [Threatens /
Defies] [Familiar Thing]", for example "The Strait of Hormuz: How 34 km of Water Holds the World Hostage".
What If titles keep the series form: "What If [Familiar Thing] [Sudden Change]?".

## First frame of every Short (it is the thumbnail in the feed)
1. Frame 1 is the hero shot: the strangest object in the story, about half the frame, already moving.
   No fade from black, no title card, no slow establishing shot.
2. Subject in the middle band. Nothing important in the bottom quarter (title and channel name) or the
   right 15% (buttons).
3. Hook text: 2-4 words in the top third, heavy sans-serif, high contrast. It adds to the title, never repeats it.
4. The first spoken line states the promise: "In 1919, a tank burst and sent a wave of molasses through Boston."

## Thumbnails and Shorts covers (home grid, channel page, search, long videos)
1. One focal object, big. Shrink it to about 120 px wide: if you can't name the object, it fails.
2. 2-5 words maximum, never the title again. The yellow kicker label stays as the house mark.
3. Shorts covers: subject and text inside the central 3:2 area (the grid crops the 9:16 frame).
4. Faceless options that work: impossible scale, before/after split, a thing in the wrong place, a circle or
   arrow on the one detail that matters.
5. No dark empty gradients, no large areas of YouTube red, white or black.
6. The first 30 seconds must keep the thumbnail's promise. YouTube ranks by watch time, not clicks.

## Measure
For Shorts, use "Stayed to watch" (viewed vs swiped away) and the average percentage viewed, not CTR. Baseline
(November 2026 Shorts): median 53 views, about 21% of each Short watched.
