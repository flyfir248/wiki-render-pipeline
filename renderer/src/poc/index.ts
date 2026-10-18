import React from "react";
import { Composition, registerRoot } from "remotion";
import { BlockyPoc } from "./Blocky";

registerRoot(() => React.createElement(Composition, { id: "Poc", component: BlockyPoc, fps: 30, width: 1080, height: 1920, durationInFrames: 345 }));
