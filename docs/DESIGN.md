# Kadenz design system — Volt

Volt is the current identity. It supersedes the v2 "Dawn" system this file used to
describe, and the coral signature and teal progress colour documented there are gone.
The authoritative source is `design_handoff_kadenz_volt/TOKENS.md` in the Kadenz Volt
design project; this file records what the app actually implements.

Architecture is unchanged from v2: `--k-*` naming, three elevation levels, gradient
twinned surfaces, translucent materials, iOS motion. Only the identity changed.

## Identity

| | |
|---|---|
| Accent | Volt lime `#C8FF3D`, ink text on top, identical in both themes |
| Signature | Kinetic aurora `linear-gradient(120deg,#C8FF3D,#35E4D4 46%,#7C5CFF)` |
| Progress | `--k-progress:#C8FF3D` into `--k-progress-2:#35E4D4` |
| Display | Anton, uppercase, `letter-spacing:.01em`, every numeral |
| Interface | Archivo 400 to 900, tabular numerals always |

## Workout types

Red is reserved for intervals and races. Kraft is blue.

| Type | Flat | Ramp (`--k-grad-*`, 180deg) |
|---|---|---|
| Easy | `#4ADE80` | `#FFE14D` to `#4ADE80` |
| Recovery | `#4ADE80` | `#4ADE80` to `#35E4D4` |
| Tempo | `#FFE14D` | `#FF8A3D` to `#FFE14D` |
| Interval | `#FF4D4D` | `#FF4D4D` to `#FF8A3D` |
| Long | `#C084FC` | `#9B6BFF` to `#7C5CFF` |
| Race | `#FF4D4D` | `#FF4D4D` to `#FF8A3D` |
| Lift / Kraft | dark `#5AA0FF`, light `#2563EB` | `#5AA0FF` to `#2563EB` |
| Rehab | `#FB923C` | `#FDBA74` to `#FB923C` |

`--k-type-lift` is the only type token that differs per theme, because `WorkoutCard`
uses one value for both graphics and 12px badge text and the light blue fails AA on a
dark card.

Rehab (`--k-type-rehab` / `--k-grad-rehab`) is the Achilles/HSR session type: a
standalone short session on a free day, or a block attached to an existing strength
session (`strength_sessions.achilles_attached`). It reads as its own thing — not a
strength sub-case — because the athlete asked to see it separately. Orange was picked
because red is reserved for intervals/races and Kraft already owns blue.

## Flats are graphics, `--vi-*` is text

Ramps and flat type colours are for spines, dots and bars. Type-coloured TEXT reads
`--vi-*`, which on ink equals the flat and on paper is darkened to clear AA:

```
light  --vi-volt:#3F6100  --vi-cyan:#0C6A62  --vi-easy:#17803D  --vi-tempo:#755C00
       --vi-interval:#C81E1E  --vi-long:#7E3AF2  --vi-lift:#1D4ED8  --vi-rehab:#9A3412
dark   the flats themselves
```

Tempo yellow measures about 1.2:1 against the paper canvas, so this is not a nicety.

## Two rules that bite

Every surface token you override needs its `-grad` twin overridden too, because
components paint `background:var(--k-surface-grad)` over `backgroundColor` and a
half-override leaves the old gradient on top.

`.k-dark-surface`, used by the always-dark brand moments, must override `--color-*`
rather than `--k-*`. Tailwind's `@theme` declares `--color-x: var(--k-x)` on `:root`
and resolves it there, so re-declaring `--k-x` on a descendant changes nothing.

Motion lives in `docs/MOTION.md`.
