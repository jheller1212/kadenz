# Kadenz — Full Review & Benchmark Comparison

> Reviewed June 3, 2026. Based on Kadenz codebase (commit 1c89f81), 33 Benchmark screenshots (IMG_1707–1739), Benchmark support docs, and 4 dedicated research agents.

---

## Part 1: What Kadenz Already Does

### Plan Engine (Excellent)
- VDOT calculator from Jack Daniels formula — converts goal race time to training paces
- 5 pace zones: Easy, Marathon, Threshold, Interval, Repetition — with min/target/max per zone
- Periodization: base > build > peak > taper, with deload and race weeks
- Weekly mileage progression with 10% ramp-up rule and cutback weeks
- Workout generation: assigns type, distance, pace zone, and block-level structure (warm-up, work intervals, cool-down) per training day
- Elevation-aware pace adjustments (flat/rolling/hilly/mountainous: +0%/+4%/+8%/+14%)
- Long run cap, easy run minimum, and difficulty controls
- Heart rate zones (Karvonen formula) — defined in code but not yet surfaced in UI

### Plan Creation Wizard (Very Good)
- 4-step wizard: Race > Goal > Preferences > Preview
- Race distances: 5K, 10K, Half, Marathon
- Scroll-picker for goal time with world-record validation and elite-level warnings
- Available days selector (min 3, max 7) — workouts only on selected days
- Difficulty: easy/moderate/hard (controls quality session count per week)
- Long run day preference
- Current weekly km slider (0–100) with beginner guidance at 0km
- Long run cap (0–42km) and easy run minimum (0–15km) sliders
- Plan preview: pace zones, phase breakdown, volume chart, race pace
- km/miles toggle throughout

### Today Screen (Good)
- Top bar: profile icon, notification bell, week selector dropdown, calendar link
- Horizontal calendar strip (MON–SUN) with swipe between weeks
- Color-coded workout dots per day (green=easy, orange=tempo, purple=interval, blue=long, red=race)
- Workout card: title, date, distance, estimated time, colored left strip, completion checkbox
- Rest day card with recovery messaging
- Week Overview: segmented progress bar, workout/distance counts
- My Insights: 2-column cards (mileage on track %, pace on point)
- Sticky "Record workout" button
- Week dropdown overlay with all weeks + "New plan" link
- Skeleton loading state
- Date-based navigation: tap any day in strip to see that day's workout

### Plan View (Good)
- Week-focused navigation: dropdown + arrows + swipe gestures
- Phase badges with color coding (base=green, build=orange, peak=purple, taper=blue)
- Drag-and-drop workout reordering per week (dnd-kit)
- Workout rows: drag handle | date | type badge + title | km + duration | expand chevron
- Expanded detail: block-by-block breakdown with pace targets per block
- Plan header: race badge, key stats (weeks/total km/days per week), micro volume chart
- Phase dividers between sections
- Past weeks dimmed

### Stats Page (Basic)
- Plan progress: week X/Y, total km, total workouts, progress bar with percentage
- This week: completion %, planned volume with progress bar
- Volume progression: bar chart across all weeks (color-coded by week type, current week outlined)
- Workout distribution: horizontal bars by type

### Settings (Good)
- Theme: light/dark with immediate apply
- Pace targets toggle + easy runs pace toggle
- Units: km/miles, Celsius/Fahrenheit
- Workout target mode: Pace vs RPE (with dedicated RPE info page at /settings/rpe)
- Create new plan link

### Technical Foundation
- Next.js 15 (App Router), TypeScript, Tailwind v4, dnd-kit, Drizzle ORM
- Postgres (Supabase/Neon), PWA with service worker + offline Today screen
- API routes: /api/plans, /api/plans/[id], /api/today, /api/workouts/[id]/complete, /api/sync/gcal, /api/auth/google
- Garmin worker: Python 3.12, FastAPI, garth (reverse-engineered Garmin Connect)
- Google Calendar sync (OAuth2, server-side token storage)
- Strava webhook receiver (activity.create) — handler defined
- Dark-mode-first design with CSS custom properties (--k-accent, --k-bg, --k-surface, etc.)
- Mobile-first layout (max-w-md, 430px)
- DB schema: users, training_plans, workouts, completed_activities, sync_tokens

---

## Part 2: What Kadenz Does NOT Do Yet

### Activity Tracking & History
- No record of completed activities with actual data (distance, time, pace, splits)
- No activity list/feed with past runs
- No monthly grouping or filtering (by type, year, month)
- No route thumbnails or maps
- No actual vs. planned comparison per workout
- No post-run feedback (thumbs up/down, how did it feel)
- No workout insights ("you ran 5% faster than target on rep 3")

### Gamification & Motivation
- No personal records (PR badges for 1K, 1MI, 5K, 10K, Half, Marathon, etc.)
- No achievement system (first run, 10 sessions, 50 runs, streak badges)
- No completed plans archive
- No all-time stats (total distance, total time, longest run, etc.)
- No "Benchmark Score" equivalent (performance metric relative to plan)

### Plan Management
- No Plan Hub screen (central dashboard with plan actions)
- No Training Calendar view (day-by-day, editable, full-plan view)
- No "+ Add workout" per day (instant/ad-hoc workouts)
- No Vacation/Holiday Mode (pause plan without losing progress)
- No "Not Feeling 100%" feature — Benchmark's is sophisticated: 4 intensity levels, 3–14 day range, return-to-training speed (slow/balanced/quickly), separate toggle for strength sessions, auto-extends if needed
- No Plan Realignment — Benchmark auto-detects missed workouts on Mondays and offers skip/rearrange/extend/rebuild options based on how much was missed (1 workout vs 1 week vs 1+ month)
- No Mileage Insights — Benchmark shows 4-state status (on track / ahead / behind / way behind) with specific recommendations (accept/dismiss)
- No coach commentary or workout briefings per week
- No estimated race time predictions based on current fitness
- No plan name customization
- No B-race support (secondary races within a plan cycle)

### Sync & Integrations
- Garmin worker exists but uses reverse-engineered auth (garth) — fragile, ToS violation
- No Garmin Connect Developer Program integration (official Training API for pushing structured workouts to watch)
- Strava webhook handler defined in code but not deployed or battle-tested
- No sync status indicators on workout cards
- Google Calendar sync defined but no UI for connection management
- No Connected Apps settings screen
- No shoe tracking / gear management

### UI Polish
- No weather widget on Today screen
- No achievement badges on completed workout cards
- No "Add Run" quick-action grid (Easy, Tempo, Intervals, Hills, Long, Race)
- No profile photo or user profile screen
- No onboarding flow for first-time users (jumps straight to empty state CTA)
- No workout detail page with rich block visualization (route exists at /workout/[id] but minimal)
- No "Workout Briefing" — Benchmark generates personalized pre-workout text including weather, hydration tips, where the session fits in the cycle, and insights from previous workout

---

## Part 3: Kadenz vs Benchmark — Full Comparison

| Aspect | Benchmark | Kadenz |
|--------|-------|--------|
| **Business model** | Subscription ($9.99/mo annual, $19.99/mo monthly) | Open-source, self-hosted, free |
| **Target audience** | Mass market, all levels, 4.9-star rated | Single user (you), technical runner |
| **Plan methodology** | Proprietary, coached by Olympians | Jack Daniels VDOT, open algorithm |
| **Plan generation** | Server-side, opaque | Client-side, fully transparent |
| **Workout types** | Running + Strength + Yoga + Pilates + Strides + Time Trial | Running only |
| **Navigation** | 5 tabs (Today/Plan/Activities/Community/Support) + Profile | 3 tabs (Today/Plan/Stats) |
| **Activity history** | Full history with metrics, badges, route maps, monthly groups, filters | Not implemented |
| **Gamification** | PRs, achievements, completed plans, streaks, Benchmark Score, Benchmark Levels | Not implemented |
| **Social** | Community spaces, polls, race groups, location groups | N/A (single-user) |
| **Coach input** | Weekly commentary + AI workout briefings + post-run insights | Algorithmic only |
| **Watch sync** | Official Garmin/Apple/COROS/Suunto/Fitbit/Amazfit | Reverse-engineered Garmin only |
| **Plan editing** | Training Calendar (day-by-day) + drag-drop (within week or +/- 1 week) | Week-focused drag-drop only |
| **Race predictions** | Estimated finish time range, updates from PRs | Not implemented |
| **Weather** | Integrated in Today view (temp, sunrise/sunset, location) | Not implemented |
| **Onboarding** | 25-30 screen quiz: goal > distance > race event > ability > schedule > terrain > volume > strength > preview > paywall > coach video | Direct to creation wizard |
| **Vacation mode** | Holiday/B-Race/Not Feeling 100% (3-14 days, 4 intensity levels, return speed options) | No |
| **Plan realignment** | Auto-detects missed sessions on Mondays, offers skip/rearrange/extend/rebuild by severity | No |
| **Mileage insights** | 4-state tracking (on track/ahead/behind/way behind) with specific recommendations | No |
| **RPE support** | Yes (toggle in Manage Plan > Units) | Yes (toggle in Settings) |
| **Elevation-aware** | Binary "hilly area" question | 4-level profile (flat/rolling/hilly/mountainous) with % adjustments |
| **Plan transparency** | Opaque (pace targets shown, algorithm hidden) | Full block-level detail, open algorithm |
| **Drag-drop reorder** | Separate Training Calendar view, within-week or +/- 1 week | Inline in plan view per week |
| **Instant workouts** | Easy/Long/Intervals/Tempo/Race/Parkrun with time/distance/pace targets | Not implemented |
| **Post-run feedback** | Thumbs up/down > follow-up options > AI Workout Insights (comparison, progress, motivation) | Mark complete only |
| **Shoe tracking** | Per-shoe mileage with replacement reminders | No |
| **Audio cues** | In-run coaching: start/stop, pace alerts, splits, halfway, with voice selection | N/A (web app) |

### Where Kadenz is BETTER than Benchmark
1. **Plan transparency** — Every block, every pace target, every phase visible and auditable. Benchmark is a black box.
2. **Elevation-aware pacing** — 4-level profile with specific percentage adjustments vs Benchmark's binary "hilly" toggle.
3. **Available days selector** — Kadenz asks "which days"; Benchmark asks "how many" then picks for you.
4. **Drag-drop editing** — Inline reordering in the plan view vs Benchmark's separate calendar mode.
5. **No subscription** — Free, self-hosted, your data stays in your Postgres.
6. **Open algorithm** — Jack Daniels VDOT is published, peer-reviewed science. You can audit and modify every calculation.
7. **RPE mode** — First-class toggle between pace targets and RPE; Benchmark added this later and it's buried in settings.
8. **Plan creation depth** — Long run cap, easy run minimum, and current weekly km baseline are more granular than Benchmark's Progressive/Steady/Gradual slider.
9. **Google Calendar sync** — Direct calendar integration for seeing workouts alongside life events. Benchmark has this but treats it as secondary.

---

## Part 4: Getting Close to Benchmark's UI/UX

### Priority 1 — Core Experience Gaps (High Impact)

#### 1A. Activity History & Actual Data
The single biggest gap. Without completed activity data, Kadenz is a plan generator, not a training companion.

**Build an Activities tab** (replace current Stats, rename bottom nav):
- **Workouts sub-tab**: Monthly groupings ("June 2026 — 142 km"), activity cards with: workout name, date/time, distance, time, avg pace, actual vs planned comparison
- **Performance sub-tab**: Weekly/monthly distance bar chart, plan progress stats, volume progression (existing), workout distribution (existing)
- **Data source**: Strava webhook activity.create > Strava API GET /activities/{id} > match to planned workout > store in completed_activities

**Post-run feedback** (simpler than Benchmark's):
- After marking complete or auto-matching from Strava: "How did it feel?" — Easy / On Target / Hard / Terrible
- Store rating, use it to suggest plan adjustments later

#### 1B. Training Calendar View
The most-used screen in Benchmark. Add as a sub-view in Plan tab (toggle between "Week View" and "Calendar"):

- Full-plan day-by-day scroll: each day shows date | colored workout card | "+ Add" button
- Completed workouts: checkmark + actual distance/time
- "GO TO THIS WEEK" floating pill for quick navigation
- Week headers: date range, WEEK N badge, total km, phase badge
- Drag workouts between days (within-week or +/- 1 week, matching Benchmark's constraint)
- Scrollable from week 1 to race week

#### 1C. "Not Feeling 100%" / Plan Adaptation
Benchmark's implementation is sophisticated. Start simpler:

- Button on Today screen or Plan tab: "Adapt this week"
- Options: "Reduce intensity" / "Easy runs only" / "Skip this week"
- Duration: rest of current week (simple) or 3–14 days (advanced)
- Engine recalculates affected weeks, preserving taper and race week
- Show what changed before confirming

#### 1D. Plan Realignment (Missed Sessions)
When the user opens Kadenz on a Monday and has missed 2+ workouts from last week:

- Bottom sheet: "You missed X workouts last week"
- Options: "Skip and continue" / "Move to this week" / "Extend plan by 1 week"
- Automatic detection, no manual trigger needed

### Priority 2 — Motivation & Engagement (Medium Impact)

#### 2A. Personal Records
Track PRs for: 1K, 1MI, 5K, 5MI, 10K, 10MI, Half, Marathon
- Auto-detect from completed activities (check if any segment of a run covers the distance faster than current PR)
- Badge grid in Performance sub-tab (hexagonal like Benchmark or circular)
- Date achieved + time shown per badge
- New PR notification when set
- Optional: feed PR improvements back into VDOT recalculation for dynamic plan adjustment

#### 2B. Plan Hub Dashboard
Landing card at top of Plan tab (before week view):
- Plan name + race distance badge (5K/10K/Half/Marathon)
- Race date countdown ("42 days to race")
- Progress: weeks completed / total, distance completed / total
- Estimated race time range (from current VDOT trend)
- Quick actions: Week View | Calendar | Settings | Adapt Plan
- Micro volume chart (existing, moved here)

#### 2C. Workout Detail Page
Enhance /workout/[id]:
- Block timeline visualization (vertical: warm-up > work > recovery > work > cool-down)
- Pace targets per block shown as colored bars with min/target/max
- Auto-generated "Workout Briefing" text explaining purpose ("This tempo run builds your lactate threshold. Run at a pace you could sustain for about an hour. The first km should feel comfortable — let the effort build naturally.")
- If completed: actual pace overlay per block, comparison summary

#### 2D. Achievement Badges
Simple milestones: First plan, First run, 10/25/50/100 runs, Weekly streak (X consecutive weeks with all planned workouts done)
- Show on Performance sub-tab
- Minimal DB: achievements table with user_id, type, date_earned

### Priority 3 — Quality of Life (Lower Impact)

#### 3A. Weather Widget
Free API: Open-Meteo (no key needed)
- Card on Today screen: temp, conditions icon, sunrise/sunset, wind
- Browser geolocation for coordinates
- Running-relevant context: "Good conditions for your long run" or "Hot — consider hydrating before you head out"

#### 3B. Instant Workouts
"Add Run" grid on Today screen (like Benchmark's colorful tiles):
- Easy Run, Tempo, Intervals, Hills, Long Run, Race
- Tapping one creates a one-off workout using plan engine defaults
- Added to today's calendar without disrupting the structured plan
- Useful for extra runs, cross-training days, or when friends want to join

#### 3C. Connected Apps Settings
Dedicated settings section for:
- Strava: OAuth status, disconnect, last sync timestamp
- Garmin: Connection status (garth or official API)
- Google Calendar: Connected calendar, sync toggle
- Shoe tracking: Name, model, total km, replacement threshold

---

## Part 5: Strava Integration (June 2026 Rules)

### What Changed on June 1, 2026

Strava overhauled their developer program to combat AI scraping ahead of their IPO:

1. **New Developer Tiers**: Standard (up to 10 athletes, self-serve) and Extended (public apps, formal review)
2. **Subscription Required**: All developers need a Strava subscription as of June 30, 2026. Active devs without one get 3 months free.
3. **Deprecated Endpoints**: Club Activities, Club Administrators, Club Members, Segments Explore — none of which Kadenz needs
4. **Technical Changes (by June 2027)**: New API base URL, auth tokens in headers only (not form params)
5. **No AI Training**: Explicit prohibition on using Strava data in AI models
6. **No Intermediaries**: Apps routing through third-party platforms are blocked
7. **Strava MCP**: New Model Context Protocol for personal data analysis — subscribers only, personal use only

### What This Means for Kadenz (All Good News)

**The Standard Tier is purpose-built for you:**
- Up to 10 athletes — covers you + 5 friends with room to spare
- Self-upgrade from API dashboard — no formal review required
- Webhook support for activity.create events — your existing architecture works
- Full access to: activity data (distance, time, pace, splits, GPS, gear), athlete profile, gear/shoe tracking
- No intermediary issues — Kadenz calls Strava directly from your Vercel deployment
- Deprecated endpoints (clubs, segments) are irrelevant to Kadenz

**Cost:**
- You need an active Strava subscription (~$11.99/mo). You likely already have one as a Garmin/Strava user.
- No additional API fees for Standard Tier

**Compliance requirements:**
- Display "Powered by Strava" compatible branding per API agreement
- Auth tokens in request headers (already best practice; form params deprecated by June 2027)
- Must not use data in AI models (not relevant — Kadenz uses VDOT math, not ML)
- Must not store data "longer than necessary" — keep completed_activities for plan duration, archive or purge after plan completes

### Recommended Strava Integration Architecture

```
User completes run with Garmin watch
    |
    v
Garmin auto-syncs to Garmin Connect (watch > phone > cloud)
    |
    v
Garmin Connect auto-syncs to Strava (linked account)
    |
    v
Strava sends webhook POST to Kadenz:
  { "object_type": "activity", "aspect_type": "create",
    "object_id": 12345, "owner_id": 67890,
    "subscription_id": 999 }
    |
    v
Kadenz API route /api/strava/webhook receives POST
    |
    v
Validate: object_type === "activity" && aspect_type === "create"
    |
    v
Fetch full activity: GET https://www.strava.com/api/v3/activities/12345
  Authorization: Bearer {user_access_token}
  Returns: distance, moving_time, elapsed_time, average_speed,
           splits_metric (per-km splits), start_date, gear_id, map.summary_polyline
    |
    v
Match to planned workout:
  1. Find workouts for owner_id on activity date
  2. Prefer type match (easy activity matches easy workout)
  3. Fall back to closest unmatched workout that day
    |
    v
Store in completed_activities table:
  workout_id, strava_activity_id, distance_km, moving_time_sec,
  avg_pace_sec_km, splits_json, gear_id, matched_at
    |
    v
Update workout status to "completed"
    |
    v
UI shows actual vs planned on workout card + activity history
```

### Strava Webhook Setup (One-Time)

```bash
# 1. Register webhook subscription
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -d client_id=YOUR_CLIENT_ID \
  -d client_secret=YOUR_CLIENT_SECRET \
  -d callback_url=https://kadenz.vercel.app/api/strava/webhook \
  -d verify_token=YOUR_VERIFY_TOKEN

# 2. Kadenz must handle the GET verification challenge:
# GET /api/strava/webhook?hub.mode=subscribe&hub.challenge=XYZ&hub.verify_token=YOUR_VERIFY_TOKEN
# Response: { "hub.challenge": "XYZ" }
```

Your existing `src/lib/sync/strava-webhook.ts` already has the skeleton for this. Needs:
1. Production webhook URL on Vercel (environment variable)
2. OAuth2 flow for each user (/api/auth/strava + /api/auth/strava/callback)
3. Token refresh logic (Strava tokens expire every 6 hours)
4. Rate limit awareness: 100 requests per 15 minutes, 1000 per day (plenty for 10 users)

### For 5 Friends — Multi-User Under Standard Tier

Standard Tier supports up to 10 athletes with zero formal review:

1. **Auth**: Use Strava OAuth as the login method — each friend clicks "Connect with Strava", authorizes Kadenz, and gets a user record in your DB
2. **Per-user data**: Store refresh tokens in sync_tokens (already in schema), each user creates their own plan
3. **Webhook routing**: activity.create events include `owner_id` — look up which user it belongs to and match against their plan
4. **Isolation**: Each user sees only their own plan, activities, and stats
5. **No review needed**: Self-serve upgrade to 10 athletes from the Strava API dashboard

This is the sweet spot of the new rules — Strava explicitly designed Standard Tier for "a beta group, or group of friends/family."

---

## Part 6: Garmin Integration — Two Paths

### Path A: Keep garth (Current — Personal Use Only)

**What it does:** Reverse-engineers Garmin Connect SSO to pull completed activities
**Pros:** Already built, works today, no approval wait
**Cons:** Can break anytime (Garmin changes SSO flow), violates Garmin ToS, can't push structured workouts to watch, doesn't scale to friends (requires sharing Garmin credentials)

**Recommendation:** Keep as fallback for yourself. Don't extend to friends.

### Path B: Garmin Connect Developer Program (Official — Recommended)

Two APIs available:

**Training API** (push workouts TO the watch):
- Publish structured workouts: warm-up > 4x800m at 4:30/km with 90s rest > cool-down
- Schedule workouts on specific dates
- Auto-syncs to compatible Garmin devices (Forerunner, Fenix, Enduro, etc.)
- Pace targets, distance, duration per step — appears on the watch face
- This is what Benchmark uses for Garmin integration

**Activity API** (pull completed activities FROM Garmin):
- Distance, time, pace, heart rate, GPS track, calories
- Webhook-style push notifications when new activities appear
- Alternative to Strava as data source (or use both for redundancy)

**Approval Process:**
1. Apply at developer.garmin.com/gc-developer-program/ — 2 business day response
2. Receive sandbox credentials
3. Build integration + test with 2+ Garmin Connect users
4. Technical review: OAuth implementation, API call volume, error handling, retry logic
5. UX review (video call): proper Garmin branding, no misrepresentation
6. Production credentials issued

**For personal/friends use:**
- The review process expects a "real app" with proper UX. Kadenz qualifies — it has a polished UI, clear purpose, and proper tech stack.
- Be upfront: "personal training plan app for a small group of runners, pushing structured workouts to Garmin devices"
- If approved: friends connect their Garmin accounts via OAuth, structured workouts appear on their watches automatically
- If denied: fall back to Strava webhook path (works regardless of watch brand)

**Recommendation:** Apply now — it's free and takes 2 days. The Training API (pushing structured workouts to watch) would be a killer feature that Kadenz can't replicate any other way. The Activity API is nice-to-have but Strava covers the same ground.

---

## Part 7: Recommended Implementation Order

### Phase 1: Strava Integration + Activity Data (2 weeks)
**Goal:** Kadenz knows what you actually ran, not just what was planned.

1. Register Strava API app at developers.strava.com
2. Build /api/auth/strava and /api/auth/strava/callback (OAuth2 code flow)
3. Deploy webhook endpoint /api/strava/webhook on Vercel
4. Implement activity fetch + workout matching logic
5. Store actual data in completed_activities table
6. Show actual vs planned on workout cards (Today screen + Plan view)
7. Build simple activity list on a new Activities page

### Phase 2: Activities Tab + Performance (1 week)
**Goal:** Replace Stats page with proper Activities experience.

1. Rename "Stats" to "Activities" in bottom nav
2. Add Workouts + Performance sub-tabs
3. Workouts: monthly grouping, activity cards with distance/time/pace
4. Performance: keep existing stats content + add PR auto-detection
5. Personal Records badge grid (1K through Marathon)
6. Post-run "How did it feel?" feedback prompt

### Phase 3: Training Calendar + Plan Hub (1 week)
**Goal:** The full-plan view runners actually want.

1. Add "Calendar" toggle to Plan tab (week view ↔ calendar view)
2. Day-by-day scroll: date + workout card + "+ Add" + completion status
3. "GO TO THIS WEEK" floating pill
4. Plan Hub card at top: name, race countdown, progress, estimated race time
5. Drag workouts between days (within-week + 1 week forward/back)

### Phase 4: Plan Adaptation (1 week)
**Goal:** Plans that respond to real life.

1. "Adapt this week" button: reduce intensity / easy only / skip
2. Missed workout detection on Monday (auto-prompt)
3. Plan realignment: skip / rearrange / extend options
4. Workout detail page enhancement: block timeline, pace bars, auto-generated briefing text

### Phase 5: Multi-User for Friends (1 week)
**Goal:** 5 friends can use Kadenz with their own plans.

1. Strava OAuth as login (each friend connects their Strava)
2. Per-user plans, workouts, activities, settings
3. Webhook routing by owner_id
4. Simple user management (no admin needed — each user is self-service)
5. Test with 2 friends, then expand

### Phase 6: Garmin Official + Polish (If Approved)
**Goal:** Structured workouts on the watch.

1. Replace garth with official Training API
2. Push structured workouts to Garmin Connect with pace targets per step
3. Optionally add Activity API as secondary data source
4. Weather widget (Open-Meteo, free)
5. Achievement badges
6. Instant workouts / "Add Run" tiles

---

## Sources

### Strava API (June 2026)
- [Developer Program Update](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428)
- [API Policy 2026](https://www.strava.com/legal/api_policy)
- [API Agreement](https://www.strava.com/legal/api)
- [API FAQ](https://communityhub.strava.com/developers-knowledge-base-14/strava-api-faq-12906)
- [Webhook Events API](https://developers.strava.com/docs/webhooks/)
- [API v3 Reference](https://developers.strava.com/docs/reference/)
- [API Agreement Update — Support](https://support.strava.com/hc/en-us/articles/31798729397773-API-Agreement-Update-How-Data-Appears-on-3rd-Party-Apps)
- [Strava declares war on scrapers (TechCrunch)](https://techcrunch.com/2026/06/01/strava-declares-war-on-scrapers-ahead-of-ipo/)
- [Strava API changes (Notebookcheck)](https://www.notebookcheck.net/Strava-just-pulled-a-Reddit-on-its-developer-community.1312468.0.html)
- [Strava charges developers $11.99/mo (Mezha)](https://mezha.net/eng/bukvy/7adff94f_strava_restricts_public/)
- [Strava tightens API (TechRepublic)](https://www.techrepublic.com/article/news-strava-api-scraping-crackdown/)
- [Strava + Benchmark Bundle Press Release](https://press.strava.com/articles/strava-benchmark-launch-combined-subscription-bundle)

### Garmin Developer
- [Connect Developer Program](https://developer.garmin.com/gc-developer-program/)
- [Training API](https://developer.garmin.com/gc-developer-program/training-api/)
- [Activity API](https://developer.garmin.com/gc-developer-program/activity-api/)
- [Program FAQ](https://developer.garmin.com/gc-developer-program/program-faq/)
- [Connect IQ SDK](https://developer.garmin.com/connect-iq/)
- [Why Integrate Garmin API Directly in 2026 (SpikeAPI)](https://www.spikeapi.com/blog/why-integrate-garmin-api-directly)

### Benchmark
- [App Review 2026 (Run with Rachel)](https://runwithrachel.co.uk/benchmark-app-review/)
- [App Review 2026 (InstaPV)](https://instapv.co.uk/benchmark-app-review/)
- [Screen Designs (ScreensDesign)](https://screensdesign.com/showcase/benchmark-running-training-plans)
- [Features](https://www.benchmark.com/features)
- [Pricing](https://www.benchmark.com/pricing)
- [Training Plans](https://www.benchmark.com/training/training-plans)
- [Key Features Guide (Support)](https://support.benchmark.com/en/articles/10473504-guide-to-key-benchmark-features)
- [Training Calendar (Support)](https://support.benchmark.com/en/articles/10137793-how-to-use-and-manage-your-training-calendar)
- [Training Preferences (Support)](https://support.benchmark.com/en/articles/10393191-how-to-use-training-preferences)
- [Running Schedule (Support)](https://support.benchmark.com/en/articles/6206024-adjusting-your-running-schedule)
- [App Features Collection (Support)](https://support.benchmark.com/en/collections/16740555-app-features)
- [FAQs Collection (Support)](https://support.benchmark.com/en/collections/3431949-benchmark-app-faqs)
- [Onboarding Flow Screenshots (Reteno)](https://gallery.reteno.com/flows/app-screens-benchmark)
- [Sentiment & Intel Report (Marlvel)](https://marlvel.ai/intel-report/health-fitness/benchmark-running-plans-coach)
- [Nike Run Club vs Benchmark (Mostly Media)](https://mostly.media/nike-run-club-vs-benchmark-which-running-app-delivers-real-value-in-2025/)
- [Strava + Benchmark Review (Mostly Media)](https://mostly.media/stravas-benchmark-app-worth-the-premium-review-breakdown/)
