#!/usr/bin/env python3
"""Weird But True frame QC: checks the measurable targets in SKILL.md sections 4.4 and 5.

  python wbt_frame_qc.py frames <video.mp4 | frame-dir> [--profile short|long] [--sombre] [--snow] [--every 1.0]
  python wbt_frame_qc.py palette '#2E6FD8' '#F08A24' ...

`frames` samples frame 1 and one frame every --every seconds (ffmpeg for videos; sorted images for a folder,
assumed 30 fps), prints one line per sample and exits 1 if any target fails.
`palette` checks that every pair of meaning-carrying colours stays distinguishable under simulated
deuteranopia and protanopia (CIE76 dE >= 20) and differs in lightness (dL* >= 20).
Needs numpy and Pillow (and ffmpeg on PATH for videos).
"""
import argparse, glob, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

TARGETS = {  # SKILL.md section 5
    False: dict(luma=(105, 170), std=40, blown=0.02, crushed=0.03, sat=(0.25, 0.55), colourful=30, first=95, empty=0.15, patch=0.08),
    True: dict(luma=(60, 115), std=32, blown=0.01, crushed=0.10, sat=(0.10, 0.32), colourful=12, first=80, empty=0.20, patch=0.10),
}


def measure(img):
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mx, mn = a.max(-1), a.min(-1)
    v = mx / 255.0
    s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    lit = v > 0.15
    rg, yb = r - g, 0.5 * (r + g) - b  # Hasler & Suesstrunk colourfulness
    m = np.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2)
    empty, patch = emptiness(img)
    return dict(empty=empty, patch=patch, luma=float(y.mean()), std=float(y.std()), blown=float((y >= 250).mean()), crushed=float((y <= 12).mean()),
                sat=float(s[lit].mean()) if lit.any() else 0.0, colourful=float(m))


def emptiness(img, cells=24):
    """Environment-density gate (SKILL.md section 3A): split the frame into square cells ~1/24 of its width and call a
    cell empty when it has almost no edges and almost no colour change (bare floor, blank wall, plain sky).
    Returns (share of the frame in empty patches of >= 2%, share covered by the largest patch)."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    y = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    g = np.zeros_like(y); g[:, 1:] += np.abs(np.diff(y, axis=1)); g[1:, :] += np.abs(np.diff(y, axis=0))
    h, w = y.shape; c = max(8, w // cells); ny, nx = h // c, w // c
    e = np.zeros((ny, nx), bool)
    for i in range(ny):
        for j in range(nx):
            gy, yy = g[i * c:(i + 1) * c, j * c:(j + 1) * c], y[i * c:(i + 1) * c, j * c:(j + 1) * c]
            e[i, j] = (gy > 12).mean() < 0.035 and yy.std() < 9
    # flat facets are the style, so a lone flat cell (a beam, a dog's flank) is fine: only connected patches of at
    # least 2% of the frame count as empty space (bare floor, blank wall, plain sky, untouched snow)
    seen, sizes = np.zeros_like(e), []
    for i in range(ny):
        for j in range(nx):
            if e[i, j] and not seen[i, j]:
                stack, n = [(i, j)], 0; seen[i, j] = True
                while stack:
                    p, q = stack.pop(); n += 1
                    for dp, dq in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        u, v = p + dp, q + dq
                        if 0 <= u < ny and 0 <= v < nx and e[u, v] and not seen[u, v]: seen[u, v] = True; stack.append((u, v))
                sizes.append(n)
    total = float(ny * nx)
    return sum(n for n in sizes if n >= 0.02 * total) / total, (max(sizes) if sizes else 0) / total


def check(mx, t, first):
    bad = []
    lo, hi = t["luma"]
    if not lo <= mx["luma"] <= hi: bad.append(f"mean luma {mx['luma']:.0f} outside {lo}-{hi}")
    if first and mx["luma"] < t["first"]: bad.append(f"frame 1 luma {mx['luma']:.0f} < {t['first']}")
    if mx["std"] < t["std"]: bad.append(f"contrast {mx['std']:.0f} < {t['std']}")
    if mx["blown"] > t["blown"]: bad.append(f"blown {mx['blown']:.1%} > {t['blown']:.0%}")
    if mx["crushed"] > t["crushed"]: bad.append(f"crushed {mx['crushed']:.1%} > {t['crushed']:.0%}")
    lo, hi = t["sat"]
    if not lo <= mx["sat"] <= hi: bad.append(f"saturation {mx['sat']:.2f} outside {lo}-{hi}")
    if mx["empty"] > t["empty"]: bad.append(f"empty {mx['empty']:.0%} > {t['empty']:.0%} (dress the set)")
    if mx["patch"] > t["patch"]: bad.append(f"largest empty patch {mx['patch']:.0%} > {t['patch']:.0%}")
    if mx["colourful"] < t["colourful"]: bad.append(f"colourfulness {mx['colourful']:.0f} < {t['colourful']}")
    return bad


def samples(src, every):
    if os.path.isdir(src):  # frame numbers come from the file names (f_0001.jpg = frame 1), 30 fps
        files = sorted(f for f in glob.glob(os.path.join(src, "*")) if f.lower().endswith((".png", ".jpg", ".jpeg")))
        num = lambda f: int("".join(ch for ch in os.path.basename(f) if ch.isdigit()) or 0)
        last = None
        for k, f in enumerate(files):
            t = (num(f) - 1) / 30.0
            if k in (0, len(files) - 1) or last is None or t - last >= every:
                last = t; yield t, Image.open(f)
        return
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-frames:v", "1", os.path.join(d, "first.png")], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", f"fps=1/{every}", os.path.join(d, "s_%04d.png")], check=True)
        yield 0.0, Image.open(os.path.join(d, "first.png"))
        for k, f in enumerate(sorted(glob.glob(os.path.join(d, "s_*.png")))):
            yield (k + 0.5) * every, Image.open(f)


# --- colour-blind palette check (Machado et al. 2009, severity 1.0, linear RGB)
SIM = {"deuteranopia": np.array([[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]]),
       "protanopia": np.array([[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]])}


def hex_rgb(h): h = h.lstrip("#"); return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)]) / 255.0
def lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def lab(linrgb):
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    x = m @ np.clip(linrgb, 0, 1) / np.array([0.95047, 1.0, 1.08883])
    f = np.where(x > 216 / 24389, np.cbrt(x), (24389 / 27 * x + 16) / 116)
    return np.array([116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])])


def palette(cols):
    bad = 0
    for i in range(len(cols)):
        for j in range(i + 1, len(cols)):
            a, b = lin(hex_rgb(cols[i])), lin(hex_rgb(cols[j]))
            la, lb = lab(a), lab(b); dl = abs(la[0] - lb[0])
            sims = {k: float(np.linalg.norm(lab(M @ a) - lab(M @ b))) for k, M in SIM.items()}
            ok = dl >= 20 and min(sims.values()) >= 20
            bad += not ok
            print(f"{'ok  ' if ok else 'FAIL'} {cols[i]} vs {cols[j]}: dL* {dl:.0f}, " + ", ".join(f"{k} dE {v:.0f}" for k, v in sims.items()))
    return bad


def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("frames"); f.add_argument("src"); f.add_argument("--profile", choices=["short", "long"], default="short")
    f.add_argument("--sombre", action="store_true"); f.add_argument("--snow", action="store_true", help="snow, fog or overcast: saturation floor 0.14"); f.add_argument("--every", type=float, default=1.0)
    p = sub.add_parser("palette"); p.add_argument("colours", nargs="+")
    a = ap.parse_args()
    if a.cmd == "palette": sys.exit(1 if palette(a.colours) else 0)
    t, fails = dict(TARGETS[a.sombre]), 0
    if a.snow: t["sat"] = (0.14, t["sat"][1])
    for k, (sec, img) in enumerate(samples(a.src, a.every)):
        mx = measure(img); bad = check(mx, t, first=(k == 0 and a.profile == "short"))
        fails += bool(bad)
        print(f"{'FAIL' if bad else 'ok  '} {'frame 1' if k == 0 else f'{sec:5.1f}s'}: luma {mx['luma']:.0f} std {mx['std']:.0f} "
              f"sat {mx['sat']:.2f} M {mx['colourful']:.0f} empty {mx['empty']:.0%}/{mx['patch']:.0%} blown {mx['blown']:.1%} crushed {mx['crushed']:.1%}"
              + ("  <- " + "; ".join(bad) if bad else ""))
    print(f"{fails} sample(s) failed" if fails else "all samples pass")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
