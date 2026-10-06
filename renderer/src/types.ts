// Contract between the Python pipeline (fyt/models.py -> RenderProps) and the
// renderer. Keep both sides in sync when adding fields or scene types.

export type Format = "long" | "short";

export type Media = {
  src: string; // path relative to the job's public dir
  kind: "video" | "image";
};

export type DataPoint = { label: string; value: number };
export type TimelineEvent = { label: string; text: string };
export type Place = { name: string; lat: number; lon: number };
export type DialogueLine = { speaker: string; text: string };

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
  | "dialogue";

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
  places?: Place[] | null; // map scenes
  route?: boolean | null; // map scenes: draw a route through the places in order
  lines?: DialogueLine[] | null; // dialogue scenes
  camera?: Camera | null; // picked per scene when not set
  transition?: Transition | null; // picked per scene when not set
};

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
  scenes: Scene[];
  captions: Word[];
  showCaptions: boolean;
  showVisualizer: boolean;
};

export type ThumbnailProps = {
  format: Format;
  title: string;
  kicker: string;
  theme: Theme;
  background: Media | null;
};
