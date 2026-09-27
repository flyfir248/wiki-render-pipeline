import type { RenderProps, Theme, ThumbnailProps } from "./types";

export const defaultTheme: Theme = {
  background: "#0b1020",
  background2: "#1b2350",
  accent: "#ffcc33",
  accent2: "#4dd6ff",
  text: "#ffffff",
  muted: "#a9b3d6",
  font: "Inter, 'Helvetica Neue', Arial, sans-serif",
};

export const dims = (format: RenderProps["format"]) =>
  format === "short" ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };

// Base unit so layouts scale between 16:9 and 9:16.
export const unit = (format: RenderProps["format"]) => (format === "short" ? 1.35 : 1);

export const sampleProps: RenderProps = {
  format: "long",
  fps: 30,
  title: "Why Compound Interest Is the 8th Wonder",
  duration: 24,
  theme: defaultTheme,
  voice: null,
  music: null,
  showCaptions: true,
  showVisualizer: true,
  scenes: [
    { id: "s1", type: "title", start: 0, end: 4, heading: "Compound Interest", text: "The quiet force behind every fortune" },
    { id: "s2", type: "stat", start: 4, end: 8, value: 1147, prefix: "$", heading: "$100 at 5% for 50 years", text: "grows to this, without adding a cent" },
    { id: "s3", type: "bars", start: 8, end: 13, heading: "Value of $1,000 over time", data: [
      { label: "10y", value: 1629 }, { label: "20y", value: 2653 }, { label: "30y", value: 4322 }, { label: "40y", value: 7040 },
    ] },
    { id: "s4", type: "list", start: 13, end: 18, heading: "Three rules", items: ["Start early", "Reinvest returns", "Never interrupt it"] },
    { id: "s5", type: "quote", start: 18, end: 24, text: "The first rule of compounding is to never interrupt it unnecessarily.", author: "Charlie Munger" },
  ],
  captions: [],
};

export const sampleThumbnail: ThumbnailProps = {
  format: "long",
  title: "The 8th Wonder of the World",
  kicker: "COMPOUND INTEREST",
  theme: defaultTheme,
  background: null,
};
