import type catalog from "./scenes/world/catalog.json";
import type { World } from "./scenes/world/storyworld/types";

// The world scene's subjects: every module listed in renderer/src/scenes/world/catalog.json.
export type Subject = keyof (typeof catalog)["subjects"];

// Contract between the Python pipeline (fyt/models.py -> RenderProps) and the
// renderer. Keep both sides in sync when adding fields or scene types.

export type Format = "long" | "short";

export type Media = {
  src: string; // path relative to the job's public dir
  kind: "video" | "image";
  styled?: string | null; // images: the photo as a halftone print (fyt/cutout.py)
  cutout?: string | null; // images: its main subject cut out, same size as the print
  aspect?: number | null; // images with a print: width / height
};

export type DataPoint = { label: string; value: number };
export type TimelineEvent = { label: string; text: string };
export type Place = { name: string; lat: number; lon: number };
export type Vehicle = "plane" | "ship" | "car" | "train" | "walk" | "army";
export type RegionChange = "appear" | "spread" | "shrink" | "fade";
export type DialogueLine = { speaker: string; text: string };
export type Setting = "sky" | "night" | "space" | "sea" | "city" | "countryside" | "desert" | "snow" | "room" | "road";
export type Effect = "explosion" | "fire" | "smoke" | "lightning" | "sparkles" | "rain" | "snow";
// One illustrated thing on a story scene's stage. Positions are 0-100 (y = 100 is the ground).
export type Actor = {
  thing: string;
  src: string; // illustration file in the job's public dir
  x: number;
  y: number;
  size: "s" | "m" | "l";
  to_x?: number | null;
  to_y?: number | null;
  enter: "pop" | "slide_left" | "slide_right" | "drop" | "rise" | "fade";
  action: "none" | "shake" | "pulse" | "spin" | "bob" | "blink" | "fall";
  at: number; // 0..1 of the scene
  label?: string | null;
};

// How the "camera" moves over a scene's photo or clip.
export type Camera = "push_in" | "pull_out" | "pan_left" | "pan_right" | "parallax";
// How a scene enters.
export type Transition = "fade" | "slide" | "zoom" | "wipe" | "flash" | "thread" | "whip";

export type SceneType =
  | "title"
  | "statement"
  | "stat"
  | "bars"
  | "list"
  | "quote"
  | "timeline"
  | "comparison"
  | "broll"
  | "map"
  | "process"
  | "document"
  | "dialogue"
  | "story"
  | "evidence"
  | "trend"
  | "proportion"
  | "scale"
  | "cycle"
  | "aircraft"
  | "ship"
  | "world"
  | "journey";

export type Scene = {
  id: string;
  type: SceneType;
  start: number; // seconds
  end: number; // seconds
  heading?: string | null;
  text?: string | null;
  items?: string[] | null;
  value?: number | null;
  prefix?: string | null;
  suffix?: string | null;
  data?: DataPoint[] | null;
  events?: TimelineEvent[] | null;
  left?: string[] | null;
  right?: string[] | null;
  leftTitle?: string | null;
  rightTitle?: string | null;
  author?: string | null;
  media?: Media | null;
  shots?: Media[] | null; // more photos to cut to after `media`
  beats?: Beat[] | null; // an illustration per later sentence
  places?: Place[] | null; // map scenes
  route?: boolean | null; // map scenes: draw a route through the places in order
  vehicle?: Vehicle | null; // map scenes: what travels the route; the camera follows it over a tilted map
  regions?: string[] | null; // map scenes: present-day countries to highlight
  regionChange?: RegionChange | null;
  yearFrom?: number | null; // map scenes: a year counter (negative for BC)
  yearTo?: number | null;
  globe?: boolean | null; // map scenes: open on a spinning globe that dives in
  lines?: DialogueLine[] | null; // dialogue scenes
  setting?: Setting | null; // story scenes
  backdropSrc?: string | null; // story scenes: an illustrated plate, drawn over the setting
  overlay?: "stat" | "proportion" | "list" | "timeline" | null; // world scenes: that template's figures drawn over the 3D scene
  world?: World | null; // stage scenes: the story world generated for this story (fyt/worldgen.py)
  actors?: Actor[] | null;
  effect?: Effect | null;
  effectX?: number | null;
  effectY?: number | null;
  effectAt?: number | null;
  effectSrc?: string | null;
  maneuver?: "cruise" | "climb" | "descend" | "dive" | "turn" | "takeoff" | "land" | "go_around" | null; // aircraft scenes
  shot?: "chase" | "side" | "front" | "below" | "orbit" | "wide" | null; // aircraft scenes: where the camera sits
  altitudeFrom?: number | null; // aircraft scenes: altitude readout in feet, counting from this...
  altitudeTo?: number | null; // ...to this, landing as the narrator says it
  weather?: "clear" | "rain" | "storm" | "fog" | "snow" | null; // aircraft and ship scenes
  vessel?: "liner" | "cargo" | "tanker" | "sailing" | "warship" | "submarine" | null; // ship scenes: what kind of ship
  shipAction?: "sail" | "turn" | "list" | "sink" | "capsize" | "collide" | "dive" | "surface" | null; // ship scenes: what it does
  obstacle?: string | null; // world scenes: what the subject hits, meets or circles (see world/catalog.json)
  subject?: Subject | null; // world scenes: what is shown, one of world/catalog.json's subjects
  variant?: string | null; // world scenes: which kind of it
  action?: string | null; // world scenes: what it does
  subjectName?: string | null; // world scenes: the thing's name; the same name looks the same in every scene
  illustrative?: boolean | null; // world scenes: labelled an illustration rather than a reconstruction
  model?: ModelRef | null; // world scenes: the model fyt/assets.py resolved (a spec's features, or a library glTF)
  label?: string | null; // world scenes: what the on-screen label says (RECONSTRUCTION, ILLUSTRATION...)
  seed?: number | null; // 3D scenes: the video's seed, so its skies, cities and liveries are its own
  landTimes?: number[] | null; // when the narrator says a stat's or proportion's figure, or each trend point, seconds from the scene's start
  revealTimes?: number[] | null; // when each evidence clue, document [hidden] word, scale item or cycle step is said, seconds from the scene's start
  camera?: Camera | null; // picked per scene when not set
  transition?: Transition | null; // picked per scene when not set
  chapter?: string | null; // long videos: a chapter starts here, and a card names it
  chapterNumber?: number | null;
  clock?: string | null; // What If videos: the stage's time stamp, drawn over the scene (components/WhatIfClock.tsx)
  clockNote?: string | null; // ...and what the premise adds up to by then ("+70 m")
  level?: number | null; // What If videos: 0-1, how far the world has gone from normal by the scene's end
  levelFrom?: number | null; // ...and where it stood as the scene began, so the world carries on from the last scene
};

// Which model a world scene draws (fyt/assets.py): a library glTF (`src`, fitted by `fit`), a spec whose
// `params` drive the procedural module (funnels, engines, stages, a molecule's atoms), or the generic one.
export type ModelRef = {
  id: string;
  level: "library" | "spec" | "generic" | "found" | "generated"; // found / generated: a stage model (fyt/assetlib.py)
  title?: string;
  kind?: string;
  params?: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  src?: string;
  fit?: { forward?: "+x" | "-x" | "+z" | "-z"; up?: "+y" | "+z" };
  clips?: string[]; // a stage model's animation clips, by name
};

// An illustration that takes over the scene when the sentence it shows begins (fyt/storyboard.py).
export type Beat = { at: number; src: string }; // seconds from the scene's start

export type Word = { word: string; start: number; end: number };

export type Theme = {
  background: string;
  background2: string;
  accent: string;
  accent2: string;
  text: string;
  muted: string;
  font: string;
  era?: "historic" | "modern"; // a story set before 1900 gets period backdrops
  grade?: string; // the video's art direction: a CSS filter over its 3D scenes (fyt/artdirect.py)
  profile?: string;
};

// A scale journey (fyt/journey.py): one unbroken camera move driven by L, the log10 of the measure in metres.
export type Journey = {
  measure: string; // the readout's label: "YOUR HEIGHT"
  keys: { t: number; L: number }[]; // L over time, seconds from the video's start
  marks: { name: string; note?: string | null; L: number }[]; // landmarks, tagged as the journey passes them
  gauges: { t: number; label: string; text: string }[]; // the second readout, from when the story brings it in
  title?: { text: string; from: number; to: number } | null;
  coldOpen?: number; // seconds at the start that show where the journey ends
  seed?: number;
};

export type RenderProps = {
  format: Format;
  fps: number;
  title: string;
  duration: number; // seconds
  theme: Theme;
  voice: string | null;
  music: { src: string; volume: number } | null;
  sfx?: { dir: string; volume: number } | null;
  scenes: Scene[];
  captions: Word[];
  showCaptions: boolean;
  showVisualizer: boolean;
  badge?: string | null; // the series name, shown small at the top
  subscribe?: string | null; // over a Short's last seconds, and on a long video's end card
  endCard?: number; // seconds held at the end of a long video for YouTube's end screen
  journey?: Journey | null; // a scale journey draws the whole picture under the scenes (journey/Journey.tsx)
};

export type ThumbnailProps = {
  format: Format;
  title: string;
  kicker: string;
  theme: Theme;
  background: Media | null;
  subject?: Media | null; // the subject cut out, drawn big over the background
};
