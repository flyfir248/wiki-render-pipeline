// The story world a stage scene carries (fyt/worldgen.py writes it): the style, the set, every actor with
// its build, and the direction. Nothing in it names a finished asset; the generators here build it all.
export type Vec3 = [number, number, number];

export type Part = {
  shape: "box" | "cylinder" | "sphere" | "cone" | "capsule" | "torus" | "wedge";
  at: Vec3;
  size: Vec3;
  rot: Vec3;
  color: string;
  bone: "body" | "head" | "torso" | "hips" | "hand_l" | "hand_r" | "back" | "tail";
  spin: "" | "x" | "y" | "z";
  glow: boolean;
};

export type Body = {
  build: number;
  legs: number;
  neck: number;
  head: number;
  snout: number;
  ears: "none" | "round" | "pointed" | "long" | "floppy";
  tail: "none" | "short" | "long" | "bushy" | "fin";
  horns: "none" | "antlers" | "horns" | "tusks" | "mane" | "crest";
  pattern: "plain" | "spots" | "stripes" | "belly" | "patches";
  age: "child" | "adult" | "elder";
};

export type Outfit = {
  top: string;
  bottom: "trousers" | "shorts" | "skirt" | "none";
  hair: string;
  beard: boolean;
  glasses: boolean;
};

export type Archetype = "humanoid" | "quadruped" | "bird" | "fish" | "insect" | "serpent" | "vehicle" | "object" | "structure" | "plant" | "cell";

export type Build = {
  entity: string;
  archetype: Archetype;
  size: number;
  primary: string;
  secondary: string;
  accent: string;
  skin: string;
  hair: string;
  body: Body;
  outfit: Outfit | null;
  parts: Part[];
  form?: string; // a detailed model the renderer draws for a vehicle its name places (airliner, boat, car)
  sex?: string; // a person: which of the character kit's bodies ("m" or "f")
};

export type Spot = "center" | "left" | "right" | "back" | "front" | "far";
export type State = "normal" | "injured" | "dazed" | "asleep" | "damaged" | "burning" | "wet";

export type CastMember = {
  entity: string;
  verb: string;
  at: Spot;
  to: Spot | "";
  face: string;
  state: State;
  holding: string;
  count?: number;
  build: Build;
  held?: Build;
  // posed: a still library animal the renderer moves as a whole (a gait, a breath, a turn)
  model?: { id: string; src: string; fit?: { forward?: string; up?: string }; clips?: string[]; posed?: boolean };
};

export type Dressing = { name: string; build: Build; count: number; spread: number };

export type SetSpec = {
  place: string;
  kind: string;
  time: "dawn" | "day" | "dusk" | "night";
  ground: string;
  sky: string;
  accent: string;
  backdrop?: "hills" | "mountains" | "city" | "vessel" | "none";
  dressing: Dressing[];
  // the place's set pieces by role (fyt/sets.py): tree, bush, rock, grass, building, tall, street, rail, prop
  pieces?: Record<string, string[]>;
};

export type Mark = { kind: "beam" | "arrow" | "path" | "ring" | "dome" | "glow"; on: string; to: string; color: string };
export type Callout = { on: string; text: string };

export type StyleName = "lowpoly" | "voxel" | "noir" | "diorama" | "clinical";

// A beat of a directed scene: from its cue on, these actors take up a new verb, go somewhere or change
// state, starting where the last beat left them, and the camera cuts to the beat's move.
export type BeatActor = { entity: string; verb?: string; to?: Spot | ""; state?: State; face?: string };
export type Beat = { from: number; cue?: string; cast: BeatActor[]; camera?: string; on?: string };

export type World = {
  style: StyleName;
  seed: number;
  set: SetSpec;
  cast: CastMember[];
  camera: string;
  on: string;
  marks: Mark[];
  callouts: Callout[];
  beats?: Beat[];
  // the character kit (fyt/kit.py): ready-made bodies and the clip libraries on their skeleton
  kit?: { bodies: { m?: string; f?: string }; clips: string[]; hair?: Record<string, string> };
};
