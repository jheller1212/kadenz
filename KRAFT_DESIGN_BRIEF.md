# Claude Design brief: Kadenz Kraft screens

Paste the section below into Claude Design. Everything in it is real: the
programme names, colours, equipment presets and durations are taken from the
shipped code, so the design lands on data that actually exists.

---

## The prompt

Design three mobile screens for **Kadenz**, a training app for runners who also
lift. Mobile-first, target 390px wide, one-handed use. The app is a dark-themed
PWA installed on a phone. There is a fixed bottom navigation bar with five
tabs: Today, Plan, Kraft, Activities, Stats. These screens live under the
**Kraft** tab, which is the strength training section. Design for dark mode as
the primary, and light mode as a secondary.

Athletes open Kraft standing in a gym, often mid-session, sometimes with cold
hands. Tap targets should be generous and the primary action should sit within
thumb reach at the bottom.

### Screen 1: Kraft hub

The screen a user lands on when they tap Kraft. It has to answer one question
fast: what am I training today, and can I start it right now.

Contents:

**A. Today's state, at the top.** One of three cases, design all three:
- A session is already planned for today. Show it and make resuming or
  starting it the single obvious action.
- A session is in progress and was left partway. Show progress and offer to
  resume.
- Nothing planned. Fall through to the programme grid as the main content.

**B. Programme grid.** A 2-column grid of cards. There are exactly three:

| Title | Subtitle | Accent colour |
|---|---|---|
| Full Body | 6 lifts, about 38 min | `#34D399` green |
| Upper | 6 lifts, about 40 min | `#93C5FD` blue |
| Lower | 4 lifts, about 35 min | `#D8B4FE` purple |

The lift count and duration are computed per user and change, so treat them as
live values, not fixed labels. Each card needs a title, that subtitle line, and
the accent colour as an identifying element. A dumbbell icon is currently used
for all three, so if you want per-programme iconography, propose it.

**C. Custom workouts.** A separate section below the grid listing workouts the
user built themselves. Each row needs start, edit and delete. Design the empty
state too, since most users will have none, plus an entry point to build one.

**D. A way into settings** for the strength plan (equipment, ability, injuries).

### Screen 2: Pre-start sheet

Tapping a programme card opens this before anything begins. It exists so the
user can see and adjust what was generated for them, since the app tailors the
session to their equipment, injuries, ability and time.

Contents:

**A. The generated exercise list.** Each row: exercise name, sets by reps, and
the suggested working weight. Rows should be reorderable and individually
swappable for an alternative. Show a live total duration estimate that visibly
updates as the list changes, because the whole point is matching the time
available.

**B. Duration selector.** Three choices: 30, 45, 60 minutes. Applies to this
session only, does not change the user's saved default. Make that scoping
legible without a paragraph of explanation.

**C. Equipment for this session.** Three presets, again for this session only:
- "Home or bodyweight": no equipment
- "CrossFit or Hyrox box": free weights, boxes, bands, benches, pull-up bars,
  no machines
- "Full gym": everything a box has, plus machines

Below the presets, the individual equipment remains editable: Dumbbells, Chair,
Box / step, Bench, Barbell, Kettlebell, Pull-up bar, Resistance band, Machines.
Presets are a shortcut that ticks those boxes, not a separate concept, so the
relationship between the two should be visually obvious.

**D. A clear primary action** to start the session.

### Screen 3: Add exercise (inside the custom workout builder)

Reached from the custom workout builder when the user adds an exercise. It
picks from an inventory of **99 exercises**, so scrolling the whole list is the
current problem and the reason this screen is being redesigned.

Contents:

**A. Search field, pinned at the top** so it stays reachable while results
scroll. Filters by exercise name as the user types.

**B. Muscle group filter chips.** Use these seven groups, not the raw data:
Legs, Calves and shins, Back, Chest, Shoulders, Arms, Core. The underlying data
has thirteen overlapping labels including some that match only one exercise, so
the groups above are the deliberate simplification. Roughly a third of the
inventory falls under Legs and a sixth under Back, so the groups are uneven and
the design should not assume equal weight.

**C. Results list.** Each row: exercise name, the muscle it trains, and the
equipment it needs. Some exercises show the user's last used weight and how
often they have done it, so design a row that can carry that without breaking
when it is absent, which is the case for any exercise they have never done.

**D. Sorting** already exists on this screen and must survive. It should sit
alongside the filter without the two competing for attention.

**E. Empty state** when a search matches nothing, with a one-tap way to clear
the search and filter together.

Search and filter combine, so the design needs to show both active at once and
make clearing either one obvious.

### Constraints

- **No em dashes anywhere in the copy.** Use commas, colons or full stops.
- Do not invent metrics, charts or scores. If a number is not named above, the
  app does not have it.
- Do not design the in-session set logger. That is a separate existing screen.
- On Screen 3, do not invent exercise imagery or illustrations. There are 99
  exercises and no artwork exists for them.
- Never reference or resemble another training app by name.
- Keep copy short and plain. These are read standing up, not sitting down.
- Assume the exercise list can be as short as 4 rows or as long as 12.

### What I want back

All three screens, in dark and light, including the three states of the top
section on Screen 1, and the empty states for custom workouts and for a search
that matches nothing. Call out anything you think is wrong with this structure
rather than only executing it.

---

## After the design exists

The functional work behind these screens is already shipped in PR #75:
per-session duration and equipment overrides are stored on `strength_sessions`
(`duration_override_minutes`, `equipment_override`), the picker already renders
`PICKER_TYPES` (`full_body`, `upper`, `lower`), and Achilles rehab now arrives
as a complaint reshaping those three rather than as its own cards.

So this is a reskin plus the exercise-list editing affordances, not new
plumbing. The one genuinely new build is the swap and reorder interaction on
the pre-start list, if the design calls for it.
