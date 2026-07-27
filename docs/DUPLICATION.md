# Duplication

A cross-screen audit found the same concept implemented inline in several
places at once, each copy drifting a little from the others: pace
formatting, missed-versus-skipped day state, session volume (four
implementations), plan distance target-versus-actual, km-baked workout
titles, weight unit conversion, and a stepper control (the "adjust a number
up or down by one" button, once with correct `aria-label`s and once without).
None of these were big enough on their own to justify a helper at the time
they were written, so nobody reached for one, and the small differences
between copies became real bugs (an inaccessible button, a wrong number) that
survived review because nothing pointed reviewers at the other copies.

## Why this keeps happening

Every instance above was simple enough to retype inline — a one-line
`.reduce(`, a `status === "skipped"` check, a two-button `+`/`-` control.
Simple code doesn't feel like it needs a shared helper, so each call site
reasons about the concept fresh, and small choices (round differently, count
warm-ups differently, forget an `aria-label`) diverge silently.

Several of these also sit on data that's ambiguous by convention only.
`strength_sets.weightKg` means load **per dumbbell**, not total — enforced by
a comment on the column, not by the type or the field name. Every new reader
has to go find that comment and re-derive the meaning, and the ones who
don't add a second, slightly different interpretation of the same field.

## Before adding display or derivation logic

Grep for the shape before writing it:

- A `.reduce(` that sums a numeric field (volume, distance, duration).
- A `formatX` / `displayX` that turns a raw value into UI text (pace, weight,
  date, unit label).
- A `status === "..."` or `kind === "..."` filter that classifies a row
  (missed vs. skipped, warm-up vs. working, planned vs. logged).
- A small tappable control that does one clearly-named job (a stepper, a
  toggle chip, a pill tag).

If something matching already exists, use it or extend it. If it's missing
an accessible label, a doc comment, or a case you need, fix it in place
rather than starting a second version next to it.

## Naming the ambiguity away

If a field's meaning depends on a convention that isn't visible in its name
or type (per-dumbbell vs. total, seconds vs. minutes, local vs. UTC), say so
in the field or type name where every reader sees it, not only in a comment
attached to one declaration or one call site. A comment is only read by
whoever is already looking at that line.

## When consolidating

Delete the old implementation once the new shared one covers its cases.
Leaving the previous copy in the tree "just in case" means the next person
who greps for the pattern finds two answers and has to guess which one is
current — that's the same failure mode this document is about, one level up.

If a production bug exposed the drift (wrong number shown, missing label,
etc.), put the exact numbers or inputs that triggered it into that helper's
regression test, not just a description of the bug.
