# Sunday marble Short: the toyshop marble machine (6 Dec 2026)

A seamless 15 s loop (450 frames, 30 fps, 1080x1920) of a wooden marble machine in a sunny toyshop. Twelve marbles
ride a bucket elevator, roll down two switchback ramps, hop down a seven-bar xylophone (one note per bar), spiral
through a funnel and roll back to the elevator. Frame 450 flows into frame 1, so the Short replays without a seam.
It follows the Infinite Marble Engine Short (23 Nov) with the same never-ending idea, but in the channel's bright
low-poly style, set in a real place, and with a tune.

- Title (25-45 chars): **The Marble Machine That Plays a Song** (37)
- Hook text in frame: TURN THE SOUND ON (constant for the whole loop, so the seam stays clean)
- Built on the shared Three.js kit `wbt_kit.js` (style skill v1.2). It renders in the cloud container with SwiftShader,
  so it doesn't use the laptop's render slot.

## Files
| File | What it is |
|---|---|
| `marble_toyshop.js` | The scene (dressing plan in its header). Every motion repeats in 15 s or a divisor of it. |
| `make_audio.py` | Synthesises the soundtrack from the page's timing (`window.MARBLE_TIMING`). No samples, no licences. |
| `assemble.sh` | Renders frames, builds the audio, encodes the MP4, and runs the density gate and frame QC. |

## Dressing plan (section 3A, medium shot, hero at 1.6 m)
- **Location and period:** a small family toyshop and workshop on a sunny town street, today, late morning.
- **Foreground:** the near edge of the workbench, wood shavings, a glass jar of spare marbles, a chisel, a hand plane.
- **Hero:** the marble machine (elevator, ramps, xylophone, funnel, return ramp, gear wheel).
- **Midground:** the toymaker sanding a toy boat at the back bench, stool, vice, paint pots, tool rack, toy shelf
  (blocks, tops, teddy), rocking horse, two hanging lamps, paper-bird mobile, bunting, potted plant, crate of offcuts.
- **Background:** the shop front and window (mirrored TOYS & MARBLES lettering, a window display), the pavement,
  a street tree, a lamp post and a bench, the road, the buildings opposite (bakery, cafe with awning and tables,
  bookshop, flats, florist).
- **Atmosphere:** dust in the light, the toymaker working, passers-by on both pavements, cars, the mobile and bunting.

Gate result (render_test.mjs, frames 1 and 450): fg 2, hero 1, mid 15, bg 12, atmosphere 5; paths clear.

## Timing (one marble's 15 s circuit; the next follows 1.25 s behind)
lift 4.41 s, tip 0.28, ramp 1.5, U-turn 0.42, ramp 1.5, U-turn 0.42, seven hops of 0.2 s (notes C5 D5 E5 G5 A5 C6 D6),
chute 0.42, funnel 2.4 (3.5 turns, speeding up as it narrows), drop 0.24, return ramp 2.01.
The elevator has 8 cups and its pulley size is chosen so the cups, pulleys and gear all return to the same look at 15 s.
Each marble's spin is eased back to its starting orientation while it sits in its cup, so the loop closes exactly.
