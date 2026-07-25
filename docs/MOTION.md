# Motion

How movement works in Kadenz. The app now has several bespoke animated moments
(boot splash, plan loader, plan reveal, completion celebration); this is the
shared grammar so the next one doesn't invent its own.

## The curve

One easing for almost everything: `cubic-bezier(0.32, 0.72, 0, 1)`, available as
`--ease-ios` in CSS and written inline as `[0.32, 0.72, 0, 1]` for `motion`.

It decelerates hard and settles without overshoot, which is what makes movement
read as *native* rather than *web*. Use `linear` only for continuous rotation
(the loader's orbiting ring) and `ease-in-out` only for symmetric breathing
loops (glow, dot pulse). Springs are not used anywhere; don't introduce them for
one screen.

## Durations

| Range | Use |
|---|---|
| 120ms | Press feedback (`.press`) |
| 200–240ms | Overlay fade in/out, celebration entry |
| 280–340ms | Sheets, splash cross-fade, phrase swaps, route transitions |
| 400–440ms | Content rising into place on a reveal |
| 1.3–5.5s | Ambient loops (breathe, glow, spin, shine, dot) |

If something needs longer than ~440ms to arrive, it's usually a sequence of
staggered elements, not one slow element.

## Stagger

Reveal content in reading order, `0.08s` apart, each rising `12px` with a fade.
`PlanReadyScreen` is the reference implementation. Keep stagger under ~7 steps;
past that the last element feels late.

## CSS keyframes vs motion

**Ambient loops belong in `globals.css` as keyframes.** Anything that repeats
forever — `k-breathe`, `k-glow`, `k-spin`, `k-shine`, `k-dot`, `k-burst` — is a
class in `globals.css`, not a `motion` prop. The reduced-motion rule at the
bottom of that file collapses every CSS animation for free, so loops written
this way are accessible with no extra code.

**Enter/exit belongs to `motion`.** Mount and unmount transitions need
`AnimatePresence` to hold the element while it leaves. Note that `motion`
animations are *not* covered by the reduced-motion CSS rule — if an enter
transition ever becomes essential to comprehension, gate it explicitly.

Corollary, learned the hard way: never rely on a `motion` fade to make a
full-screen overlay visible in a context where the animation may not run (a
`initial={{ opacity: 0 }}` overlay is invisible if the animation never starts).
Progress and other state that must survive should be driven by inline style from
real state, not by an animation.

## Overlay layering

| z-index | Layer |
|---|---|
| `z-[60]` | Full-screen flow states (plan loader, reveal, error) |
| `z-[70]` | Celebration, over a flow state |
| `z-[80]` | Permission primer sheet |
| `z-[100]` | Boot splash — above everything, first paint only |

## Always-dark surfaces

The splash, loader, reveal and error screens are brand moments and stay dark in
either theme by adding `.k-dark-surface`.

That class overrides `--color-*`, **not** `--k-*`, and must stay that way.
Tailwind's `@theme` declares `--color-x: var(--k-x)` on `:root`, and a custom
property is substituted where it is *declared* — so `--color-x` has already
resolved against `html.light` before it inherits down. Re-declaring `--k-x` on a
descendant changes nothing. Anything a dark surface needs must be added to
`.k-dark-surface` as a `--color-*` entry, which is why those screens are
typographic rather than card-based: adding `bg-surface` would mean duplicating
most of the dark palette.

## Reduced motion

`prefers-reduced-motion: reduce` collapses all CSS animations and transitions
globally. Designed states must survive that: the plan loader still shows real
progress and cycling phrases with every loop frozen, because the bar's width is
an inline style driven by `requestAnimationFrame`.

Test it: macOS System Settings → Accessibility → Display → Reduce motion.

## Haptics

Movement usually pairs with `haptic()` from `lib/haptics`: `light` for
selection, `medium` for commit/advance, `success` on completion, `warning` on
failure. Don't fire haptics on ambient motion or auto-dismissals — only on
something the athlete did.
