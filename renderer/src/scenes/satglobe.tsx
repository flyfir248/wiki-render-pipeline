// The opening globe drawn from a satellite texture: every pixel of the disc is turned back into a
// longitude and latitude (the inverse of the orthographic projection the atlas globe uses) and
// coloured from an equirectangular image of the Earth. Drawn at half resolution and scaled up.
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { continueRender, delayRender, staticFile } from "remotion";

type Texture = { data: Uint8ClampedArray; w: number; h: number };
const textures = new Map<string, Promise<Texture>>();

const load = (src: string): Promise<Texture> => {
  if (!textures.has(src)) {
    textures.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          resolve({ data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height });
        };
        img.onerror = reject;
        img.src = staticFile(src);
      }),
    );
  }
  return textures.get(src)!;
};

export const SatGlobe: React.FC<{
  src: string;
  center: [number, number]; // the lon/lat facing the camera
  radius: number;
  at: [number, number];
  width: number;
  height: number;
}> = ({ src, center, radius, at, width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tex, setTex] = useState<Texture | null>(null);
  const [handle] = useState(() => delayRender(`globe texture ${src}`));
  useEffect(() => {
    load(src)
      .then((t) => setTex(t))
      .catch(() => continueRender(handle));
  }, [src, handle]);

  const W = Math.ceil(width / 2);
  const H = Math.ceil(height / 2);
  // drawn before the frame is painted, so every captured frame has its globe
  useLayoutEffect(() => {
    if (!tex || !ref.current) return;
    const ctx = ref.current.getContext("2d")!;
    const out = ctx.createImageData(W, H);
    const o = out.data;
    const r = radius / 2;
    const cx = at[0] / 2;
    const cy = at[1] / 2;
    const l0 = (center[0] * Math.PI) / 180;
    const p0 = (center[1] * Math.PI) / 180;
    const sp = Math.sin(p0);
    const cp = Math.cos(p0);
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(H, Math.ceil(cy + r));
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(W, Math.ceil(cx + r));
    for (let py = y0; py < y1; py++) {
      const y = -(py + 0.5 - cy) / r;
      for (let px = x0; px < x1; px++) {
        const x = (px + 0.5 - cx) / r;
        const rho2 = x * x + y * y;
        if (rho2 >= 1) continue;
        const rho = Math.sqrt(rho2);
        const sc = rho; // sin(c) on a unit orthographic disc
        const cc = Math.sqrt(1 - rho2);
        const lat = rho ? Math.asin(cc * sp + (y * sc * cp) / rho) : p0;
        const lon = l0 + Math.atan2(x * sc, rho * cc * cp - y * sc * sp);
        let u = ((lon / (2 * Math.PI) + 0.5) % 1 + 1) % 1;
        const v = 0.5 - lat / Math.PI;
        const tx = Math.min(tex.w - 1, Math.floor(u * tex.w));
        const ty = Math.min(tex.h - 1, Math.max(0, Math.floor(v * tex.h)));
        const ti = (ty * tex.w + tx) * 4;
        // light from the upper left, and the limb darkening towards the edge
        const light = 0.55 + 0.45 * Math.max(0, cc * 0.8 + (-x * 0.35 + y * 0.45));
        const i = (py * W + px) * 4;
        o[i] = tex.data[ti] * light;
        o[i + 1] = tex.data[ti + 1] * light;
        o[i + 2] = tex.data[ti + 2] * light;
        // soften the very edge of the disc
        o[i + 3] = Math.min(255, (1 - rho) * r * 255);
      }
    }
    ctx.putImageData(out, 0, 0);
    continueRender(handle);
  }, [tex, center[0], center[1], radius, at[0], at[1], W, H, handle]);

  return <canvas ref={ref} width={W} height={H} style={{ position: "absolute", inset: 0, width, height }} />;
};
