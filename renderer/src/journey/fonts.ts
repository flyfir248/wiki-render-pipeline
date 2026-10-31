// The journey's serif (Caladea, SIL Open Font License 1.1, by the Caladea Project Authors), bundled with
// the renderer so a render looks the same on any machine. Rendering waits until it has loaded.
import { continueRender, delayRender } from "remotion";
import regular from "./fonts/Caladea-Regular.ttf";
import italic from "./fonts/Caladea-Italic.ttf";
import bold from "./fonts/Caladea-Bold.ttf";

export const SERIF = "JourneySerif, Caladea, 'DejaVu Serif', Georgia, serif";

let loaded = false;
export const loadJourneyFonts = () => {
  if (loaded || typeof document === "undefined") return;
  loaded = true;
  const handle = delayRender("journey fonts");
  const faces = [
    new FontFace("JourneySerif", `url(${regular})`, { style: "normal", weight: "400" }),
    new FontFace("JourneySerif", `url(${italic})`, { style: "italic", weight: "400" }),
    new FontFace("JourneySerif", `url(${bold})`, { style: "normal", weight: "700" }),
  ];
  Promise.all(faces.map((f) => f.load()))
    .then((all) => all.forEach((f) => (document.fonts as unknown as { add: (x: FontFace) => void }).add(f)))
    .catch((e) => console.warn("journey fonts did not load", e))
    .finally(() => continueRender(handle));
};
