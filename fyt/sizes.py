"""Real sizes, in metres, for the Spatial Director (fyt/animation.py).

Each entry is (words, metres): the words a story's entity is matched on (its name, kind and search
terms, whole words, the most specific entry first) and its typical real length (a vehicle, an animal,
an object, a weapon), height (a person, a building, a tree) or diameter (a cell, a planet). A size the
story's own sources state beats this table; the table beats the 3D designer's guess.
"""

from __future__ import annotations

import re

# Most specific first: "ac-130" before "c-130" before "aircraft". A row's words are whole words or
# phrases ("b-52" also matches "b52", see _norm).
SIZES: list[tuple[tuple[str, ...], float]] = [
    # --- aircraft ---------------------------------------------------------------------------------
    (("ac-130", "ac130", "gunship"), 29.8), (("c-130", "c130", "hercules"), 29.8), (("c-17", "globemaster"), 53.0),
    (("c-5", "galaxy"), 75.3), (("an-225", "mriya"), 84.0), (("b-52", "stratofortress"), 48.5), (("b-2", "spirit bomber"), 21.0),
    (("b-1", "lancer"), 44.5), (("b-29", "superfortress", "enola gay", "bockscar"), 30.2), (("b-17", "flying fortress"), 22.7),
    (("lancaster",), 21.1), (("f-16", "fighting falcon"), 15.0), (("f-15", "eagle fighter"), 19.4), (("f-22", "raptor"), 18.9),
    (("f-35", "lightning ii"), 15.7), (("f-14", "tomcat"), 19.1), (("f-117", "nighthawk"), 20.1), (("sr-71", "blackbird"), 32.7),
    (("u-2", "dragon lady"), 19.2), (("mig-21",), 14.7), (("mig-29",), 17.3), (("su-27",), 21.9), (("spitfire",), 9.1),
    (("mustang", "p-51"), 9.8), (("zero", "a6m"), 9.1), (("messerschmitt", "bf 109", "bf-109"), 9.0), (("concorde",), 61.7),
    (("a380",), 72.7), (("747", "jumbo jet", "jumbo"), 70.7), (("777",), 63.7), (("787", "dreamliner"), 56.7), (("767",), 54.9),
    (("757",), 47.3), (("737",), 39.5), (("a320",), 37.6), (("a330",), 63.7), (("a350",), 66.8), (("dc-10",), 55.5),
    (("airliner", "jetliner", "passenger jet", "passenger plane"), 40.0), (("cessna", "light aircraft", "light plane", "piper"), 8.3),
    (("glider",), 7.0), (("seaplane", "floatplane"), 11.0), (("biplane", "wright flyer"), 7.5), (("zeppelin", "hindenburg", "airship"), 245.0),
    (("hot air balloon", "balloon"), 20.0), (("chinook", "ch-47"), 30.1), (("black hawk", "blackhawk", "uh-60"), 19.8),
    (("apache", "ah-64"), 17.7), (("huey", "uh-1"), 17.4), (("helicopter", "chopper"), 15.0), (("predator", "reaper", "mq-9", "mq-1"), 11.0),
    (("drone",), 1.0), (("bomber",), 40.0), (("fighter jet", "fighter plane", "jet fighter", "fighter aircraft"), 17.0),
    (("cargo plane", "transport plane", "transport aircraft", "military transport"), 35.0), (("jet",), 20.0),
    (("aircraft", "airplane", "aeroplane", "plane", "warplane"), 20.0),
    # --- space ------------------------------------------------------------------------------------
    (("saturn v",), 110.6), (("space shuttle", "shuttle"), 56.1), (("falcon 9",), 70.0), (("starship",), 121.0), (("soyuz",), 46.3),
    (("apollo command module", "command module"), 3.9), (("lunar module", "lunar lander"), 7.0), (("capsule",), 4.0),
    (("international space station", "iss", "space station"), 109.0), (("hubble",), 13.2), (("satellite", "sputnik"), 4.0),
    (("rover", "curiosity", "perseverance"), 3.0), (("rocket", "launch vehicle"), 50.0),
    (("moon",), 3_474_000.0), (("earth",), 12_742_000.0), (("asteroid", "meteor"), 50.0), (("meteorite",), 1.0),
    # --- weapons and munitions -------------------------------------------------------------------
    (("moab", "gbu-43", "massive ordnance air blast", "mother of all bombs"), 9.2), (("blu-82", "daisy cutter"), 3.7),
    (("gbu-57", "massive ordnance penetrator", "bunker buster"), 6.2), (("tsar bomba",), 8.0), (("little boy",), 3.0),
    (("fat man",), 3.3), (("atomic bomb", "nuclear bomb", "a-bomb", "hydrogen bomb"), 3.5), (("grand slam", "tallboy"), 7.7),
    (("v-2", "v2 rocket"), 14.0), (("v-1", "doodlebug", "buzz bomb"), 8.3), (("tomahawk", "cruise missile"), 6.2),
    (("icbm", "minuteman", "intercontinental ballistic missile"), 18.0), (("scud",), 11.2), (("hellfire",), 1.6), (("javelin missile",), 1.1),
    (("torpedo",), 6.0), (("missile",), 5.0), (("bomb",), 2.5), (("artillery shell", "shell"), 0.8), (("grenade",), 0.1),
    (("landmine", "land mine", "sea mine"), 0.3), (("cannon",), 3.0), (("tank", "abrams", "panzer", "tiger tank", "sherman"), 7.9),
    (("rifle", "musket", "gun"), 1.0), (("pistol", "revolver", "handgun"), 0.22), (("sword",), 0.9), (("spear",), 2.2), (("bow",), 1.5),
    (("crossbow",), 0.9), (("catapult", "trebuchet"), 10.0), (("parachute",), 8.0),
    # --- ships and boats --------------------------------------------------------------------------
    (("titanic", "olympic", "britannic"), 269.0), (("lusitania", "mauretania"), 240.0), (("queen mary",), 311.0),
    (("aircraft carrier", "nimitz"), 333.0), (("battleship", "yamato", "bismarck", "uss missouri"), 260.0),
    (("destroyer",), 150.0), (("frigate",), 130.0), (("submarine", "u-boat", "sub"), 90.0), (("cruise ship",), 300.0),
    (("ocean liner", "liner", "steamship", "steamer"), 220.0), (("oil tanker", "tanker", "supertanker"), 330.0),
    (("container ship", "freighter", "cargo ship"), 300.0), (("ferry",), 120.0), (("trawler", "fishing boat"), 25.0),
    (("tugboat", "tug"), 30.0), (("yacht",), 25.0), (("mary celeste", "brigantine", "schooner"), 31.0),
    (("galleon", "man-of-war", "frigate ship"), 50.0), (("mayflower",), 30.0), (("viking ship", "longship"), 23.0),
    (("ark", "noah's ark"), 137.0), (("sailing ship", "clipper", "tall ship"), 60.0), (("lifeboat",), 9.0), (("canoe", "kayak"), 5.0),
    (("raft",), 4.0), (("rowboat", "dinghy"), 4.0), (("speedboat",), 8.0), (("ship", "vessel", "warship"), 120.0), (("boat",), 8.0),
    # --- land vehicles ----------------------------------------------------------------------------
    (("locomotive", "steam engine"), 20.0), (("train",), 100.0), (("tram", "streetcar"), 25.0), (("bus", "coach"), 12.0),
    (("lorry", "truck", "semi"), 12.0), (("fire engine", "fire truck"), 10.0), (("ambulance",), 6.5), (("tractor",), 4.5),
    (("van", "minivan"), 5.0), (("jeep", "suv", "humvee", "land rover"), 4.8), (("police car", "taxi", "sedan", "car"), 4.5),
    (("motorcycle", "motorbike", "scooter"), 2.1), (("bicycle", "bike"), 1.8), (("carriage", "stagecoach", "wagon", "cart"), 4.0),
    (("chariot",), 2.5), (("sled", "sleigh"), 2.5), (("bulldozer", "excavator"), 7.0),
    # --- animals ----------------------------------------------------------------------------------
    (("blue whale",), 25.0), (("sperm whale",), 16.0), (("humpback",), 15.0), (("orca", "killer whale"), 7.0), (("whale",), 15.0),
    (("whale shark",), 12.0), (("great white", "great white shark"), 5.0), (("shark",), 3.0), (("dolphin", "porpoise"), 2.5),
    (("giant squid",), 12.0), (("octopus",), 1.5), (("seal", "sea lion"), 2.0), (("walrus",), 3.2), (("manatee",), 3.5),
    (("elephant", "mammoth"), 6.5), (("giraffe",), 4.5), (("rhino", "rhinoceros"), 3.8), (("hippo", "hippopotamus"), 4.0),
    (("tyrannosaurus", "t-rex", "t. rex"), 12.3), (("brachiosaurus", "sauropod", "diplodocus"), 25.0), (("triceratops",), 9.0),
    (("velociraptor", "raptor dinosaur"), 2.0), (("dinosaur",), 10.0), (("crocodile", "alligator"), 4.5), (("komodo dragon",), 2.6),
    (("anaconda", "python"), 5.0), (("cobra", "snake", "viper", "serpent"), 1.8), (("polar bear",), 2.4), (("grizzly",), 2.2),
    (("black bear",), 1.7), (("bear",), 2.0), (("tiger",), 2.9), (("lion",), 2.5), (("leopard", "jaguar"), 2.0), (("cheetah",), 2.0),
    (("wolf",), 1.6), (("hyena",), 1.5), (("fox",), 0.9), (("gorilla",), 1.7), (("chimp", "chimpanzee"), 1.2), (("monkey",), 0.6),
    (("horse", "stallion", "mare"), 2.4), (("donkey", "mule"), 2.0), (("camel",), 3.0), (("moose", "elk"), 3.0), (("deer", "stag"), 1.8),
    (("bison", "buffalo"), 3.0), (("cow", "bull", "ox", "cattle"), 2.4), (("pig", "boar"), 1.5), (("sheep", "goat"), 1.3),
    (("gazelle", "antelope", "impala"), 1.3), (("zebra",), 2.4), (("kangaroo",), 1.6), (("dog", "hound", "puppy"), 1.0),
    (("cat", "kitten"), 0.5), (("rabbit", "hare"), 0.45), (("rat",), 0.25), (("mouse",), 0.1), (("squirrel",), 0.4),
    (("ostrich",), 2.5), (("emu",), 1.8), (("eagle", "vulture", "condor", "albatross"), 0.9), (("hawk", "falcon", "owl"), 0.5),
    (("goose", "geese", "swan", "pelican"), 0.9), (("duck", "gull", "seagull", "crow", "raven", "pigeon", "parrot"), 0.4),
    (("penguin",), 1.0), (("sparrow", "songbird", "robin"), 0.15), (("bat",), 0.15), (("turtle", "tortoise"), 1.0),
    (("frog", "toad"), 0.1), (("lizard",), 0.3), (("bee", "wasp", "fly", "mosquito", "ant", "flea"), 0.012), (("spider",), 0.05),
    (("scorpion",), 0.1), (("butterfly", "moth"), 0.08), (("locust", "grasshopper", "beetle", "cockroach"), 0.05),
    (("crab", "lobster"), 0.4), (("jellyfish",), 0.5), (("fish", "salmon", "trout", "cod", "carp"), 0.6), (("tuna",), 2.0),
    # --- people -----------------------------------------------------------------------------------
    (("baby", "infant", "toddler"), 0.8), (("child", "kid", "boy", "girl"), 1.3), (("person", "man", "woman", "people", "human",
      "soldier", "pilot", "sailor", "crew", "passenger", "worker", "scientist", "doctor", "nurse", "hiker", "astronaut", "diver",
      "farmer", "blacksmith", "villager", "king", "queen", "monk", "priest", "explorer", "detective", "officer"), 1.75),
    # --- structures and places -------------------------------------------------------------------
    (("eiffel tower",), 330.0), (("great pyramid", "pyramid of giza"), 139.0), (("pyramid",), 100.0), (("statue of liberty",), 93.0),
    (("empire state building",), 443.0), (("burj khalifa",), 828.0), (("twin towers", "world trade center"), 417.0),
    (("skyscraper",), 250.0), (("lighthouse",), 30.0), (("castle",), 30.0), (("cathedral", "church"), 40.0), (("temple",), 20.0),
    (("tower",), 50.0), (("bridge",), 300.0), (("dam",), 150.0), (("house", "cottage", "cabin", "hut"), 8.0), (("barn",), 10.0),
    (("tent",), 2.5), (("factory", "warehouse", "hangar"), 20.0), (("hospital", "school", "prison"), 20.0), (("well",), 1.0),
    (("windmill",), 20.0), (("forge", "anvil"), 1.0), (("volcano",), 2000.0), (("mountain",), 3000.0), (("iceberg",), 120.0),
    (("tree", "oak", "pine"), 15.0), (("redwood", "sequoia"), 90.0), (("palm",), 15.0), (("bush", "shrub"), 1.5), (("flower",), 0.4),
    # --- objects ----------------------------------------------------------------------------------
    (("shipping container", "container"), 12.2), (("crate",), 1.2), (("barrel", "drum"), 0.9), (("box", "package", "parcel"), 0.5),
    (("suitcase", "briefcase"), 0.6), (("bag", "backpack", "sack"), 0.5), (("coffin",), 2.0), (("chest", "treasure chest"), 0.9),
    (("table",), 1.6), (("chair",), 0.9), (("bed",), 2.0), (("door",), 2.1), (("statue",), 3.0), (("bell",), 1.0), (("anchor",), 2.0),
    (("camera",), 0.15), (("phone", "smartphone"), 0.15), (("radio",), 0.3), (("computer", "laptop"), 0.35), (("book", "letter",
      "diary", "map"), 0.25), (("bottle",), 0.3), (("coin",), 0.025), (("ring",), 0.02), (("key",), 0.06), (("skull",), 0.22),
    (("bone",), 0.4), (("lantern", "torch", "flashlight"), 0.3), (("clock",), 0.4),
    # --- the microscopic --------------------------------------------------------------------------
    (("red blood cell", "erythrocyte"), 8e-6), (("white blood cell", "leukocyte", "lymphocyte", "macrophage"), 1.2e-5),
    (("platelet",), 3e-6), (("neuron", "nerve cell"), 1e-4), (("egg cell", "ovum"), 1.2e-4), (("sperm",), 5e-5),
    (("bacterium", "bacteria", "e. coli", "microbe"), 2e-6), (("virus", "coronavirus", "virion"), 1e-7), (("antibody",), 1e-8),
    (("protein", "enzyme", "receptor"), 5e-9), (("dna", "helix"), 2e-9), (("molecule",), 1e-9), (("atom",), 1e-10),
    (("cell",), 2e-5), (("tardigrade",), 5e-4),
    # --- organs -----------------------------------------------------------------------------------
    (("heart",), 0.12), (("brain",), 0.15), (("lung",), 0.25), (("liver",), 0.2), (("kidney",), 0.11), (("stomach",), 0.25),
    (("eye", "eyeball"), 0.024), (("tooth",), 0.02), (("hand",), 0.19),
]


def _norm(text: str) -> str:
    """Lower case, with hyphens and spaces in model names made optional: 'B52', 'b 52' and 'B-52' alike."""
    return re.sub(r"\s+", " ", text.lower().replace("’", "'")).strip()


def _pattern(word: str) -> str:
    w = re.escape(_norm(word)).replace(r"\-", "[- ]?").replace(r"\ ", "[- ]?")
    return rf"(?<![a-z0-9]){w}(?:e?s)?(?![a-z0-9])"


_COMPILED = [(tuple(re.compile(_pattern(w)) for w in words), size) for words, size in SIZES]


def lookup(text: str) -> tuple[float, str] | None:
    """The typical real size of the thing the text names, and the word it matched; None when the table
    has nothing for it. The most specific row wins (the table is ordered so), so 'AC-130 gunship' is
    29.8 m, not a generic aircraft's 20."""
    low = _norm(text)
    for pats, size in _COMPILED:
        for p in pats:
            m = p.search(low)
            if m:
                return size, m.group(0)
    return None


UNITS = {"m": 1.0, "metre": 1.0, "metres": 1.0, "meter": 1.0, "meters": 1.0, "ft": 0.3048, "feet": 0.3048, "foot": 0.3048,
         "cm": 0.01, "centimetres": 0.01, "centimeters": 0.01, "mm": 0.001, "km": 1000.0, "kilometres": 1000.0, "kilometers": 1000.0,
         "in": 0.0254, "inches": 0.0254, "yd": 0.9144, "yards": 0.9144, "µm": 1e-6, "micrometres": 1e-6, "micrometers": 1e-6,
         "microns": 1e-6, "nm": 1e-9, "nanometres": 1e-9, "nanometers": 1e-9}
DIMENSION = re.compile(
    r"\b(length|long|wingspan|wing span|span|height|tall|high|diameter|across|beam)\b[^.;\n]{0,40}?"
    r"(\d[\d,]*(?:\.\d+)?)\s*(m|metres|meters|metre|meter|ft|feet|foot|cm|centimetres|centimeters|mm|km|kilometres|kilometers|"
    r"inches|yd|yards|µm|micrometres|micrometers|microns|nm|nanometres|nanometers)\b"
    r"|(\d[\d,]*(?:\.\d+)?)\s*(m|metres|meters|metre|meter|ft|feet|foot|cm|mm|km|inches|yd|yards|µm|microns|nm)"
    r"\)?(?:\s*\([^)]*\))?\s*(long|in length|tall|high|in height|wide|across|in diameter|wingspan)\b",
    re.I,
)


def stated(text: str, names: list[str], window: int = 260) -> float | None:
    """A size the text states for one of the names: a dimension ('length 9.19 m', 'a wingspan of 40.4 m',
    '30 feet long') within `window` characters after a name. The largest stated (a span beats a height
    for framing), in metres; None when the text states none near the names."""
    low = text.lower()
    found: list[float] = []
    for name in names:
        n = _norm(name)
        if len(n) < 3:
            continue
        for m in re.finditer(re.escape(n), low):
            chunk = text[m.start(): m.start() + window]
            chunk = re.split(r"[.;!?]\s+(?=[A-Z])", chunk)[0]  # this sentence: the next may be about something else
            for d in DIMENSION.finditer(chunk):
                num, unit = (d.group(2), d.group(3)) if d.group(2) else (d.group(4), d.group(5))
                try:
                    v = float(num.replace(",", "")) * UNITS[unit.lower()]
                except (KeyError, ValueError):
                    continue
                if v > 0:
                    found.append(v)
    return max(found) if found else None
