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
export type Transition = "fade" | "slide" | "zoom" | "wipe" | "flash";

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
  | "evidence";

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
  actors?: Actor[] | null;
  effect?: Effect | null;
  effectX?: number | null;
  effectY?: number | null;
  effectAt?: number | null;
  effectSrc?: string | null;
  revealTimes?: number[] | null; // when each evidence clue or document [hidden] word is said, seconds from the scene's start
  camera?: Camera | null; // picked per scene when not set
  transition?: Transition | null; // picked per scene when not set
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
};

export type ThumbnailProps = {
  format: Format;
  title: string;
  kicker: string;
  theme: Theme;
  background: Media | null;
};
