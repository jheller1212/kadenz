# Claude Design brief: Kadenz screens

Paste the section below into Claude Design. Every number, colour, label and
constraint is taken from shipped code as of 2026-07-31, so the design lands on
what the app actually does.

---

## The prompt

Design five mobile screens for **Kadenz**, a training app for runners who also
lift. Mobile-first, target 390px wide, one-handed use. It is a dark-themed PWA
installed on a phone, with a fixed bottom navigation bar of five tabs: Today,
Plan, Kraft, Activities, Stats. Design dark mode as primary and light mode as
secondary.

Athletes open these screens standing in a gym, often mid-session, sometimes
with cold hands. Tap targets are generous, minimum 44px, and the primary action
sits within thumb reach at the bottom.

### Screen 1: Kraft hub

The screen behind the Kraft tab. It answers one question fast: what am I
training today, and can I start it now.

**A. Today's state, at the top.** Three cases, design all three:
- a session already planned for today, with resuming or starting it as the one
  obvious action
- a session left partway, offering to continue, complete or discard it
- nothing planned, falling through to the programme grid

**B. Programme grid.** Two columns, exactly three cards:

| Title | Subtitle | Accent |
|---|---|---|
| Full Body | 6 lifts, about 38 min | `#34D399` |
| Upper | 6 lifts, about 40 min | `#93C5FD` |
| Lower | 4 lifts, about 35 min | `#D8B4FE` |

Lift counts and durations are computed per athlete and change, so treat them as
live values. A dumbbell icon is used for all three today; propose per-programme
iconography if you want it.

**C. Custom workouts.** Their own section below, each row with start, edit and
delete, plus the empty state, which is what most athletes see.

**D. A way into Kraft settings.**

### Screen 2: Pre-start sheet

Opens on tapping a programme, before anything begins. It exists so the athlete
can see and adjust what was generated for them.

**A. The generated exercise list.** Each row: exercise name, sets by reps, and
suggested working weight. Reorderable and individually swappable. A live total
duration estimate that visibly updates as the list changes.

**B. Duration.** 30, 45 or 60 minutes, applying to **this session only**,
without changing the athlete's saved default.

**C. Equipment for this session only.** Three presets: "Home or bodyweight",
"CrossFit or Hyrox box", "Full gym". Below them the nine individual items stay
editable: Dumbbells, Chair, Box or step, Bench, Barbell, Kettlebell, Pull-up
bar, Resistance band, Machines. Presets tick those boxes rather than being a
separate concept, so show that relationship.

**D. A clear primary action** to start.

After starting, the applied choices appear on the session overview, for example
"45 min today, Gym today", so the athlete can confirm they took effect.

### Screen 3: Add exercise

Reached from the custom workout builder. It picks from **88 exercises**, so
scrolling is the problem being solved.

**A. Search pinned at the top**, staying reachable while results scroll.

**B. Ten muscle group chips:** Quads, Hamstrings, Glutes, Calves and shins,
Chest, Back, Shoulders, Biceps, Triceps, Core.

Ten chips do not fit one row at 390px. Solve that deliberately and say how.
The groups are deliberately uneven: Glutes, Core and Shoulders have around 30
exercises each, Calves and shins has 8. An exercise can belong to several
groups, so a chip filters rather than partitions and the same exercise
legitimately appears under more than one.

**C. Results rows:** name, the muscle it trains, the equipment it needs. Some
rows carry the athlete's last used weight and how often they have done it, and
**any exercise they have never done has neither**, so the row must survive that
being absent.

**D. Sorting already exists** and must not compete with the filter for
attention.

**E. Empty state** when nothing matches, clearing search and filter together.

### Screen 4: Connections

Used twice, in onboarding and in settings, sharing one design. Nothing here may
imply a device is required.

**"Bring your runs in"**
- **Strava.** "Your runs import automatically, with pace, heart rate and the
  route."
- **Garmin.** Only appears for athletes who can actually use it. Sends workouts
  to the watch, and returns sleep, resting heart rate and HRV that feed the
  readiness score.
- **Apple Health.** A **non-interactive row**, not a toggle: "Apple Health has
  no web connection, it needs the phone app", with a "Not yet" pill.

**"Send your sessions out"**
- **Google Calendar.** "Your sessions appear in your calendar. Nothing comes
  back in." It is a destination, not a source, so keep it visually distinct
  from the group above.

**"Or record by hand"**
- A **full-width card**, the same weight as the options above, never a grey
  link: "I'll record by hand. You log runs from the Activities tab, and
  readiness comes from your daily check-in."

An athlete with no device is normal, not lapsed. Skipping must feel equal to
connecting.

### Screen 5: Kraft settings

Where an athlete changes what the generator does.

**A. Complaints.** A switch per running complaint, each row naming the exercises
that complaint adds. Turning one off opens a confirmation naming exactly what
stops, stating that logged sets and pain scores are kept, and warning that
re-reporting restarts the calf protocol from week 1.

**B. Equipment, ability, session length, rest**, as saved defaults, clearly
distinct from the per-session overrides on Screen 2.

**C. An entry point to the full setup wizard** for an athlete who has not run it.

### Constraints

- **No em dashes anywhere in the copy.** Commas, colons or full stops.
- Do not invent metrics, charts or scores. If a number is not named here, the
  app does not have it.
- Do not design the in-session set logger. It exists and is out of scope.
- No exercise imagery. There are 88 exercises and no artwork exists.
- Never reference or resemble another training app by name.
- Copy is short and plain. These are read standing up.
- Exercise lists run from 4 to 12 rows.
- Nothing may imply a device, a watch or a connected account is required.

### What I want back

All five screens in dark and light, including the three states on Screen 1, the
empty states on Screens 1 and 3, and the confirmation on Screen 5. Call out
anything you think is wrong with this structure rather than only executing it.

---

## Notes for whoever implements the result

The plumbing exists. Per-session duration and equipment overrides are stored on
`strength_sessions`, the picker renders `full_body`, `upper` and `lower`,
complaints are editable through `settings/kraft`, and the connections
preference is persisted per user. This is a reskin plus the swap and reorder
affordances on Screen 2, not new backend work.
