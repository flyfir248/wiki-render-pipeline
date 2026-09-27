// Contract between the Python pipeline (fyt/models.py -> RenderProps) and the
// renderer. Keep both sides in sync when adding fields or scene types.

export type Format = "long" | "short";

export type Media = {
  src: string; // path relative to the job's public dir
  kind: "video" | "image";
};

export type DataPoint = { label: string; value: number };
export type TimelineEvent = { label: string; text: string };

export type SceneType =
  | "title"
  | "statement"
  | "stat"
  | "bars"
  | "list"
  | "quote"
  | "timeline"
  | "comparison"
  | "broll";

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
