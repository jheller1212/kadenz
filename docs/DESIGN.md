# Kadenz Design System v2 — "iOS-native depth"

Source of truth: the **Kadenz Design System** project on claude.ai/design
(`b614bb73-3c25-4ebe-9ae1-8bbd4c6f3501`) — tokens, component specs, specimen
cards, and a rendered Today screen. This file is the in-repo digest; the tokens
live in `web/src/app/globals.css`.

## Principles

- The clarity of a best-in-class running app, but *our* identity — cool-neutral palette, depth and light
  instead of flat fills. Like Apple Fitness / iOS widgets: layered, material.
- **Gradients are a system, not decoration.** Every surface token has a `-grad`
  twin (2–4% vertical luminance shift). Gradients never sit under body text —
  only large display numerals or white ink.
- **One signature moment per screen.** `--k-signature-grad` (identity: "Dawn",
  sunrise coral→rose; alternates `--k-sig-kinetic`, `--k-sig-aurora`) appears at
  most once per screen: active-plan header, week ring hero, completion states.
- **Three elevation levels.** 0 = canvas (`--k-bg`), 1 = card (`.k-card`:
  gradient + 0.5px ring + `--k-shadow-card`, borderless), 2 = floating
  (`.k-float`: `--k-shadow-float`). Dark expresses elevation through *lighter
  surfaces* (#17181B → #212227 → #26282E), not shadows.
- The progress teal `#2DD4BF` (kinetic pair → `#38BDF8`) is the only persistent
  chroma. The workout-type spectrum (`--k-type-*`) carries meaning, never
  decoration.

## Tokens (all in `globals.css`; dark = `:root` default, light = `html.light`)

| Group | Tokens |
|---|---|
| Surfaces | `--k-bg(-grad)`, `--k-surface(-grad)`, `--k-elevated`, `--k-float(-grad)`, `--k-hairline` |
| Text (AA everywhere) | `--k-text-1/2/3` — light text-3 is #646973 (v1 #969BA6 failed AA) |
| Accent | `--k-accent(-grad)` — near-black lit gradient (light), near-white (dark); `--k-on-accent` |
| Progress | `--k-progress`, `--k-progress-2` (ring/bar gradients) |
| Signature | `--k-signature-grad`, `--k-signature-ink`, `--k-sig-dawn/kinetic/aurora` |
| Semantic | `--k-warn`, `--k-danger`, `--k-success` |
| Types | `--k-type-easy/recovery/tempo/interval/long/race` |
| Elevation | `--k-shadow-card`, `--k-shadow-float`, `--k-ring-hairline` |
| Material | `--k-material`, `--k-material-border`, `--k-scrim` + `.material` blur class |

## Utility classes

- `.k-card` / `.k-float` — elevation-1/2 surfaces (replace `bg-surface border
  border-hairline` — v2 cards are borderless).
- `.k-signature` — the hero gradient surface (`--k-signature-ink` text only).
- `.press` — scale 0.96 + brightness dip (light) / lift (dark). No hover styling.
- `.material`, `.hairline-t/b` — translucent blurred bars. Static surfaces
  ONLY — never on drag targets or animating list items (60fps).

## Rules of thumb

- Corners: card 20 / input 14 / sheet 28 / chips full-round. Page padding 20px,
  card stack gap 16px, max width 430px.
- Type: system stack (SF Pro), weights do the hierarchy — extrabold 34 large
  titles, bold 17–20 headings, medium 15 body, semibold 13 controls, 10px
  uppercase tracked micro-labels. Tabular numerals always.
- Icons: lucide only, strokeWidth 1.5–2 (2.4 active tab). No emoji in UI.
- Voice: terse, coach-like, sentence case, numbers first ("12km", "Week 6/12").
- Motion: `--ease-ios`; springs for tab icons/knobs; sheets 0.34s slide-up;
  everything collapses under reduced-motion.

## Do / don't (gradients)

- DO: surface washes on static cards, the accent "lit" treatment on primary
  buttons, kinetic gradient on progress rings, one signature hero per screen.
- DON'T: gradients under body text, on drag targets/animating rows, more than
  one signature moment per screen, blur on anything that moves.
