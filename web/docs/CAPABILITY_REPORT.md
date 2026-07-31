# Kadenz capability report

Generated, not hand-maintained. Regenerate with `npm run report:capabilities` from `web/` (runs `scripts/generate-capability-report.ts`).

Generated at `2026-07-31T09:36:08.547Z` from commit `6b81315f03b51300f26cdee4414ee8a36bbc01db`.

This file answers only "what exists in the code, with proof": every row below has a file and line reference, and every reference is re-derived from the source on each run, not copied from a prior version of this file. It says nothing about what is designed, planned, or matches a brief — that judgement, and its own tracking columns, belongs to the design project's STATUS.md.

## Schema tables and columns

Parsed from `src/db/schema.ts` (26 tables). A column listed here exists in the table type; it does not mean a migration has been applied to every environment.

### `users` (`users`) — src/db/schema.ts:178

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:179 |
| `email` | `email` | src/db/schema.ts:180 |
| `displayName` | `display_name` | src/db/schema.ts:181 |
| `distanceUnit` | `distance_unit` | src/db/schema.ts:186 |
| `weightUnit` | `weight_unit` | src/db/schema.ts:189 |
| `deviceSetupAt` | `device_setup_at` | src/db/schema.ts:194 |
| `deviceConnections` | `device_connections` | src/db/schema.ts:197 |
| `createdAt` | `created_at` | src/db/schema.ts:200 |
| `updatedAt` | `updated_at` | src/db/schema.ts:203 |

### `userIdentities` (`user_identities`) — src/db/schema.ts:211

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:214 |
| `userId` | `user_id` | src/db/schema.ts:215 |
| `provider` | `provider` | src/db/schema.ts:219 |
| `providerAccountId` | `provider_account_id` | src/db/schema.ts:222 |
| `email` | `email` | src/db/schema.ts:223 |
| `createdAt` | `created_at` | src/db/schema.ts:224 |
| `lastLoginAt` | `last_login_at` | src/db/schema.ts:227 |

### `integrationCredentials` (`integration_credentials`) — src/db/schema.ts:248

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:251 |
| `userId` | `user_id` | src/db/schema.ts:252 |
| `provider` | `provider` | src/db/schema.ts:256 |
| `payload` | `payload` | src/db/schema.ts:267 |
| `createdAt` | `created_at` | src/db/schema.ts:268 |
| `updatedAt` | `updated_at` | src/db/schema.ts:271 |

### `userIntegrationState` (`user_integration_state`) — src/db/schema.ts:293

| column | db column | line |
|---|---|---|
| `userId` | `user_id` | src/db/schema.ts:296 |
| `key` | `key` | src/db/schema.ts:299 |
| `value` | `value` | src/db/schema.ts:300 |
| `updatedAt` | `updated_at` | src/db/schema.ts:301 |

### `profiles` (`profiles`) — src/db/schema.ts:311

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:314 |
| `name` | `name` | src/db/schema.ts:315 |
| `color` | `color` | src/db/schema.ts:316 |
| `active` | `active` | src/db/schema.ts:321 |
| `userId` | `user_id` | src/db/schema.ts:322 |
| `createdAt` | `created_at` | src/db/schema.ts:325 |

### `plans` (`plans`) — src/db/schema.ts:332

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:335 |
| `name` | `name` | src/db/schema.ts:336 |
| `intent` | `intent` | src/db/schema.ts:339 |
| `raceDistance` | `race_distance` | src/db/schema.ts:340 |
| `customDistanceKm` | `custom_distance_km` | src/db/schema.ts:342 |
| `goalTimeSeconds` | `goal_time_seconds` | src/db/schema.ts:343 |
| `vdot` | `vdot` | src/db/schema.ts:344 |
| `startDate` | `start_date` | src/db/schema.ts:345 |
| `raceDate` | `race_date` | src/db/schema.ts:346 |
| `planLengthWeeks` | `plan_length_weeks` | src/db/schema.ts:347 |
| `daysPerWeek` | `days_per_week` | src/db/schema.ts:348 |
| `preferredLongRunDay` | `preferred_long_run_day` | src/db/schema.ts:349 |
| `weekStartDay` | `week_start_day` | src/db/schema.ts:350 |
| `currentWeeklyKm` | `current_weekly_km` | src/db/schema.ts:351 |
| `trainingVolume` | `training_volume` | src/db/schema.ts:352 |
| `trainingDifficulty` | `training_difficulty` | src/db/schema.ts:353 |
| `longRunCapKm` | `long_run_cap_km` | src/db/schema.ts:354 |
| `easyRunMinKm` | `easy_run_min_km` | src/db/schema.ts:355 |
| `hillyArea` | `hilly_area` | src/db/schema.ts:356 |
| `runnerLevel` | `runner_level` | src/db/schema.ts:358 |
| `availableDays` | `available_days` | src/db/schema.ts:360 |
| `status` | `status` | src/db/schema.ts:361 |
| `userId` | `user_id` | src/db/schema.ts:362 |
| `createdAt` | `created_at` | src/db/schema.ts:365 |
| `updatedAt` | `updated_at` | src/db/schema.ts:368 |

### `weeks` (`weeks`) — src/db/schema.ts:378

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:381 |
| `planId` | `plan_id` | src/db/schema.ts:382 |
| `weekNumber` | `week_number` | src/db/schema.ts:385 |
| `phase` | `phase` | src/db/schema.ts:386 |
| `type` | `type` | src/db/schema.ts:387 |
| `targetKm` | `target_km` | src/db/schema.ts:388 |
| `actualKm` | `actual_km` | src/db/schema.ts:389 |
| `skippedAt` | `skipped_at` | src/db/schema.ts:397 |
| `skipReason` | `skip_reason` | src/db/schema.ts:398 |
| `skipSnapshot` | `skip_snapshot` | src/db/schema.ts:403 |
| `userId` | `user_id` | src/db/schema.ts:404 |
| `createdAt` | `created_at` | src/db/schema.ts:407 |

### `workouts` (`workouts`) — src/db/schema.ts:418

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:421 |
| `weekId` | `week_id` | src/db/schema.ts:422 |
| `planId` | `plan_id` | src/db/schema.ts:425 |
| `dayOfWeek` | `day_of_week` | src/db/schema.ts:428 |
| `date` | `date` | src/db/schema.ts:429 |
| `type` | `type` | src/db/schema.ts:430 |
| `title` | `title` | src/db/schema.ts:431 |
| `description` | `description` | src/db/schema.ts:432 |
| `status` | `status` | src/db/schema.ts:433 |
| `targetKm` | `target_km` | src/db/schema.ts:434 |
| `actualKm` | `actual_km` | src/db/schema.ts:435 |
| `rpe` | `rpe` | src/db/schema.ts:437 |
| `edited` | `edited` | src/db/schema.ts:439 |
| `targetDurationMinutes` | `target_duration_minutes` | src/db/schema.ts:440 |
| `actualDurationSeconds` | `actual_duration_seconds` | src/db/schema.ts:443 |
| `timeOfDay` | `time_of_day` | src/db/schema.ts:447 |
| `gcalEventId` | `gcal_event_id` | src/db/schema.ts:448 |
| `garminWorkoutId` | `garmin_workout_id` | src/db/schema.ts:449 |
| `stravaActivityId` | `strava_activity_id` | src/db/schema.ts:450 |
| `sortOrder` | `sort_order` | src/db/schema.ts:451 |
| `raceFinishSeconds` | `race_finish_seconds` | src/db/schema.ts:458 |
| `raceFeel` | `race_feel` | src/db/schema.ts:461 |
| `raceResultLoggedAt` | `race_result_logged_at` | src/db/schema.ts:462 |
| `userId` | `user_id` | src/db/schema.ts:463 |
| `createdAt` | `created_at` | src/db/schema.ts:466 |
| `updatedAt` | `updated_at` | src/db/schema.ts:469 |

### `blocks` (`blocks`) — src/db/schema.ts:482

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:485 |
| `workoutId` | `workout_id` | src/db/schema.ts:486 |
| `sortOrder` | `sort_order` | src/db/schema.ts:489 |
| `type` | `type` | src/db/schema.ts:490 |
| `durationMinutes` | `duration_minutes` | src/db/schema.ts:491 |
| `distanceKm` | `distance_km` | src/db/schema.ts:492 |
| `targetPaceSecKm` | `target_pace_sec_km` | src/db/schema.ts:493 |
| `minPaceSecKm` | `min_pace_sec_km` | src/db/schema.ts:494 |
| `maxPaceSecKm` | `max_pace_sec_km` | src/db/schema.ts:495 |
| `reps` | `reps` | src/db/schema.ts:496 |
| `repDistanceKm` | `rep_distance_km` | src/db/schema.ts:497 |
| `repRestSeconds` | `rep_rest_seconds` | src/db/schema.ts:498 |
| `userId` | `user_id` | src/db/schema.ts:499 |
| `createdAt` | `created_at` | src/db/schema.ts:502 |

### `activities` (`activities`) — src/db/schema.ts:512

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:515 |
| `workoutId` | `workout_id` | src/db/schema.ts:516 |
| `strengthSessionId` | `strength_session_id` | src/db/schema.ts:521 |
| `sportType` | `sport_type` | src/db/schema.ts:527 |
| `stravaId` | `strava_id` | src/db/schema.ts:532 |
| `garminId` | `garmin_id` | src/db/schema.ts:535 |
| `provider` | `provider` | src/db/schema.ts:540 |
| `externalId` | `external_id` | src/db/schema.ts:541 |
| `name` | `name` | src/db/schema.ts:542 |
| `distanceKm` | `distance_km` | src/db/schema.ts:543 |
| `durationSeconds` | `duration_seconds` | src/db/schema.ts:544 |
| `avgPaceSecKm` | `avg_pace_sec_km` | src/db/schema.ts:545 |
| `avgHr` | `avg_hr` | src/db/schema.ts:546 |
| `maxHr` | `max_hr` | src/db/schema.ts:547 |
| `elevationGain` | `elevation_gain` | src/db/schema.ts:548 |
| `maxElevation` | `max_elevation` | src/db/schema.ts:549 |
| `startDate` | `start_date` | src/db/schema.ts:550 |
| `splitsJson` | `splits_json` | src/db/schema.ts:551 |
| `lapsJson` | `laps_json` | src/db/schema.ts:552 |
| `polyline` | `polyline` | src/db/schema.ts:555 |
| `aiInsight` | `ai_insight` | src/db/schema.ts:557 |
| `aiInsightGeneratedAt` | `ai_insight_generated_at` | src/db/schema.ts:558 |
| `bestEffortsJson` | `best_efforts_json` | src/db/schema.ts:563 |
| `cadenceSpm` | `cadence_spm` | src/db/schema.ts:564 |
| `calories` | `calories` | src/db/schema.ts:565 |
| `deviceName` | `device_name` | src/db/schema.ts:566 |
| `gearName` | `gear_name` | src/db/schema.ts:567 |
| `streamsJson` | `streams_json` | src/db/schema.ts:571 |
| `userId` | `user_id` | src/db/schema.ts:572 |
| `createdAt` | `created_at` | src/db/schema.ts:575 |

### `deletedActivities` (`deleted_activities`) — src/db/schema.ts:614

| column | db column | line |
|---|---|---|
| `stravaId` | `strava_id` | src/db/schema.ts:617 |
| `userId` | `user_id` | src/db/schema.ts:618 |
| `deletedAt` | `deleted_at` | src/db/schema.ts:621 |

### `activityTrash` (`activity_trash`) — src/db/schema.ts:628

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:631 |
| `payload` | `payload` | src/db/schema.ts:632 |
| `userId` | `user_id` | src/db/schema.ts:633 |
| `deletedAt` | `deleted_at` | src/db/schema.ts:636 |

### `personalRecords` (`personal_records`) — src/db/schema.ts:641

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:644 |
| `distance` | `distance` | src/db/schema.ts:645 |
| `timeSeconds` | `time_seconds` | src/db/schema.ts:646 |
| `date` | `date` | src/db/schema.ts:647 |
| `source` | `source` | src/db/schema.ts:648 |
| `userId` | `user_id` | src/db/schema.ts:649 |
| `createdAt` | `created_at` | src/db/schema.ts:652 |

### `syncOutbox` (`sync_outbox`) — src/db/schema.ts:662

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:665 |
| `entityType` | `entity_type` | src/db/schema.ts:666 |
| `entityId` | `entity_id` | src/db/schema.ts:667 |
| `action` | `action` | src/db/schema.ts:668 |
| `target` | `target` | src/db/schema.ts:669 |
| `payload` | `payload` | src/db/schema.ts:670 |
| `status` | `status` | src/db/schema.ts:671 |
| `idempotencyKey` | `idempotency_key` | src/db/schema.ts:683 |
| `attempts` | `attempts` | src/db/schema.ts:684 |
| `lastError` | `last_error` | src/db/schema.ts:685 |
| `createdAt` | `created_at` | src/db/schema.ts:686 |
| `processedAt` | `processed_at` | src/db/schema.ts:689 |
| `claimedAt` | `claimed_at` | src/db/schema.ts:692 |
| `userId` | `user_id` | src/db/schema.ts:693 |

### `strengthExercises` (`strength_exercises`) — src/db/schema.ts:709

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:712 |
| `slug` | `slug` | src/db/schema.ts:713 |
| `name` | `name` | src/db/schema.ts:714 |
| `category` | `category` | src/db/schema.ts:715 |
| `equipmentNote` | `equipment_note` | src/db/schema.ts:716 |
| `tempoNote` | `tempo_note` | src/db/schema.ts:717 |
| `flatGroundOnly` | `flat_ground_only` | src/db/schema.ts:719 |
| `slowProgressor` | `slow_progressor` | src/db/schema.ts:721 |
| `defaultSets` | `default_sets` | src/db/schema.ts:722 |
| `repLow` | `rep_low` | src/db/schema.ts:723 |
| `repHigh` | `rep_high` | src/db/schema.ts:724 |
| `startWeightKg` | `start_weight_kg` | src/db/schema.ts:726 |
| `sortOrder` | `sort_order` | src/db/schema.ts:727 |
| `createdAt` | `created_at` | src/db/schema.ts:728 |

### `strengthSessions` (`strength_sessions`) — src/db/schema.ts:735

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:738 |
| `planId` | `plan_id` | src/db/schema.ts:740 |
| `profileId` | `profile_id` | src/db/schema.ts:744 |
| `date` | `date` | src/db/schema.ts:747 |
| `dayOfWeek` | `day_of_week` | src/db/schema.ts:748 |
| `type` | `type` | src/db/schema.ts:749 |
| `title` | `title` | src/db/schema.ts:750 |
| `status` | `status` | src/db/schema.ts:751 |
| `targetDurationMinutes` | `target_duration_minutes` | src/db/schema.ts:752 |
| `durationMinutes` | `duration_minutes` | src/db/schema.ts:753 |
| `notes` | `notes` | src/db/schema.ts:754 |
| `gcalEventId` | `gcal_event_id` | src/db/schema.ts:755 |
| `garminWorkoutId` | `garmin_workout_id` | src/db/schema.ts:756 |
| `autoScheduled` | `auto_scheduled` | src/db/schema.ts:758 |
| `watchEligible` | `watch_eligible` | src/db/schema.ts:768 |
| `sortOrder` | `sort_order` | src/db/schema.ts:769 |
| `exerciseOverrides` | `exercise_overrides` | src/db/schema.ts:776 |
| `exerciseOrder` | `exercise_order` | src/db/schema.ts:794 |
| `complaints` | `complaints` | src/db/schema.ts:802 |
| `equipmentOverride` | `equipment_override` | src/db/schema.ts:811 |
| `durationOverrideMinutes` | `duration_override_minutes` | src/db/schema.ts:812 |
| `startedAt` | `started_at` | src/db/schema.ts:819 |
| `endedAt` | `ended_at` | src/db/schema.ts:820 |
| `userId` | `user_id` | src/db/schema.ts:821 |
| `createdAt` | `created_at` | src/db/schema.ts:824 |
| `updatedAt` | `updated_at` | src/db/schema.ts:827 |

### `strengthSets` (`strength_sets`) — src/db/schema.ts:841

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:844 |
| `sessionId` | `session_id` | src/db/schema.ts:845 |
| `exerciseId` | `exercise_id` | src/db/schema.ts:848 |
| `setNumber` | `set_number` | src/db/schema.ts:851 |
| `weightKg` | `weight_kg` | src/db/schema.ts:852 |
| `reps` | `reps` | src/db/schema.ts:853 |
| `rpe` | `rpe` | src/db/schema.ts:854 |
| `durationSeconds` | `duration_seconds` | src/db/schema.ts:855 |
| `feel` | `feel` | src/db/schema.ts:861 |
| `kind` | `kind` | src/db/schema.ts:866 |
| `createdAt` | `created_at` | src/db/schema.ts:867 |

### `wellnessLogs` (`wellness_logs`) — src/db/schema.ts:886

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:889 |
| `date` | `date` | src/db/schema.ts:892 |
| `profileId` | `profile_id` | src/db/schema.ts:894 |
| `restDay` | `rest_day` | src/db/schema.ts:897 |
| `illness` | `illness` | src/db/schema.ts:898 |
| `injury` | `injury` | src/db/schema.ts:899 |
| `bodyweightKg` | `bodyweight_kg` | src/db/schema.ts:900 |
| `energy` | `energy` | src/db/schema.ts:901 |
| `sleepQuality` | `sleep_quality` | src/db/schema.ts:902 |
| `soreness` | `soreness` | src/db/schema.ts:903 |
| `note` | `note` | src/db/schema.ts:904 |
| `userId` | `user_id` | src/db/schema.ts:905 |
| `createdAt` | `created_at` | src/db/schema.ts:908 |
| `updatedAt` | `updated_at` | src/db/schema.ts:911 |

### `wellnessMetrics` (`wellness_metrics`) — src/db/schema.ts:928

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:931 |
| `date` | `date` | src/db/schema.ts:935 |
| `sleepSeconds` | `sleep_seconds` | src/db/schema.ts:936 |
| `restingHr` | `resting_hr` | src/db/schema.ts:937 |
| `hrvLastNightAvg` | `hrv_last_night_avg` | src/db/schema.ts:938 |
| `hrvWeeklyAvg` | `hrv_weekly_avg` | src/db/schema.ts:942 |
| `hrvStatus` | `hrv_status` | src/db/schema.ts:943 |
| `source` | `source` | src/db/schema.ts:944 |
| `userId` | `user_id` | src/db/schema.ts:945 |
| `createdAt` | `created_at` | src/db/schema.ts:948 |
| `updatedAt` | `updated_at` | src/db/schema.ts:951 |

### `painLogs` (`pain_logs`) — src/db/schema.ts:967

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:970 |
| `sessionId` | `session_id` | src/db/schema.ts:971 |
| `score` | `score` | src/db/schema.ts:974 |
| `timing` | `timing` | src/db/schema.ts:975 |
| `settledWithin24h` | `settled_within_24h` | src/db/schema.ts:977 |
| `note` | `note` | src/db/schema.ts:978 |
| `createdAt` | `created_at` | src/db/schema.ts:979 |

### `strengthPlanSettings` (`strength_plan_settings`) — src/db/schema.ts:988

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:991 |
| `profileId` | `profile_id` | src/db/schema.ts:992 |
| `goal` | `goal` | src/db/schema.ts:995 |
| `durationMinutes` | `duration_minutes` | src/db/schema.ts:996 |
| `sessionsPerWeek` | `sessions_per_week` | src/db/schema.ts:997 |
| `ability` | `ability` | src/db/schema.ts:998 |
| `availableDays` | `available_days` | src/db/schema.ts:999 |
| `equipment` | `equipment` | src/db/schema.ts:1000 |
| `active` | `active` | src/db/schema.ts:1001 |
| `blockWeeks` | `block_weeks` | src/db/schema.ts:1004 |
| `blockStartDate` | `block_start_date` | src/db/schema.ts:1005 |
| `bodyweightKg` | `bodyweight_kg` | src/db/schema.ts:1010 |
| `sex` | `sex` | src/db/schema.ts:1011 |
| `complaints` | `complaints` | src/db/schema.ts:1017 |
| `achillesStartedAt` | `achilles_started_at` | src/db/schema.ts:1025 |
| `restSeconds` | `rest_seconds` | src/db/schema.ts:1029 |
| `userId` | `user_id` | src/db/schema.ts:1030 |
| `createdAt` | `created_at` | src/db/schema.ts:1033 |
| `updatedAt` | `updated_at` | src/db/schema.ts:1036 |

### `customWorkoutTemplates` (`custom_workout_templates`) — src/db/schema.ts:1047

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:1050 |
| `profileId` | `profile_id` | src/db/schema.ts:1052 |
| `name` | `name` | src/db/schema.ts:1055 |
| `userId` | `user_id` | src/db/schema.ts:1056 |
| `createdAt` | `created_at` | src/db/schema.ts:1059 |
| `updatedAt` | `updated_at` | src/db/schema.ts:1062 |

### `customWorkoutSlots` (`custom_workout_slots`) — src/db/schema.ts:1073

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:1076 |
| `templateId` | `template_id` | src/db/schema.ts:1077 |
| `exerciseSlug` | `exercise_slug` | src/db/schema.ts:1080 |
| `sets` | `sets` | src/db/schema.ts:1081 |
| `repLow` | `rep_low` | src/db/schema.ts:1082 |
| `repHigh` | `rep_high` | src/db/schema.ts:1083 |
| `weightKg` | `weight_kg` | src/db/schema.ts:1084 |
| `restSeconds` | `rest_seconds` | src/db/schema.ts:1085 |
| `sortOrder` | `sort_order` | src/db/schema.ts:1086 |
| `createdAt` | `created_at` | src/db/schema.ts:1087 |

### `pushSubscriptions` (`push_subscriptions`) — src/db/schema.ts:1121

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:1124 |
| `endpoint` | `endpoint` | src/db/schema.ts:1125 |
| `p256dh` | `p256dh` | src/db/schema.ts:1128 |
| `auth` | `auth` | src/db/schema.ts:1129 |
| `transport` | `transport` | src/db/schema.ts:1130 |
| `userId` | `user_id` | src/db/schema.ts:1131 |
| `createdAt` | `created_at` | src/db/schema.ts:1134 |

### `reminderSettings` (`reminder_settings`) — src/db/schema.ts:1148

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:1151 |
| `enabled` | `enabled` | src/db/schema.ts:1152 |
| `leadMinutes` | `lead_minutes` | src/db/schema.ts:1154 |
| `defaultTimeOfDay` | `default_time_of_day` | src/db/schema.ts:1157 |
| `userId` | `user_id` | src/db/schema.ts:1158 |
| `updatedAt` | `updated_at` | src/db/schema.ts:1161 |

### `sentReminders` (`sent_reminders`) — src/db/schema.ts:1191

| column | db column | line |
|---|---|---|
| `id` | `id` | src/db/schema.ts:1194 |
| `workoutId` | `workout_id` | src/db/schema.ts:1195 |
| `status` | `status` | src/db/schema.ts:1199 |
| `attempts` | `attempts` | src/db/schema.ts:1200 |
| `lastAttemptAt` | `last_attempt_at` | src/db/schema.ts:1201 |
| `sentAt` | `sent_at` | src/db/schema.ts:1202 |
| `userId` | `user_id` | src/db/schema.ts:1203 |
| `fields` | `—` | src/db/schema.ts:1227 |
| `references` | `—` | src/db/schema.ts:1228 |
| `fields` | `—` | src/db/schema.ts:1234 |
| `references` | `—` | src/db/schema.ts:1235 |
| `fields` | `—` | src/db/schema.ts:1241 |
| `references` | `—` | src/db/schema.ts:1242 |
| `sets` | `—` | src/db/schema.ts:1249 |
| `plan` | `—` | src/db/schema.ts:1256 |
| `sets` | `—` | src/db/schema.ts:1260 |
| `painLogs` | `—` | src/db/schema.ts:1261 |
| `fields` | `—` | src/db/schema.ts:1267 |
| `references` | `—` | src/db/schema.ts:1268 |
| `fields` | `—` | src/db/schema.ts:1271 |
| `references` | `—` | src/db/schema.ts:1272 |
| `slots` | `—` | src/db/schema.ts:1279 |
| `template` | `—` | src/db/schema.ts:1286 |
| `fields` | `—` | src/db/schema.ts:1295 |
| `references` | `—` | src/db/schema.ts:1296 |

## API routes

Walked from `src/app/api/` (80 route files).

| route | methods | file |
|---|---|---|
| `/api/activities` | GET (:44) | src/app/api/activities/route.ts |
| `/api/activities/[id]` | GET (:23), PATCH (:219), DELETE (:326) | src/app/api/activities/[id]/route.ts |
| `/api/activities/[id]/candidates` | GET (:15) | src/app/api/activities/[id]/candidates/route.ts |
| `/api/activities/[id]/exercise-order` | GET (:14) | src/app/api/activities/[id]/exercise-order/route.ts |
| `/api/activities/[id]/insights` | POST (:46) | src/app/api/activities/[id]/insights/route.ts |
| `/api/activities/manual` | POST (:25) | src/app/api/activities/manual/route.ts |
| `/api/activities/trash` | GET (:12) | src/app/api/activities/trash/route.ts |
| `/api/activities/trash/[id]` | DELETE (:11) | src/app/api/activities/trash/[id]/route.ts |
| `/api/activities/trash/[id]/restore` | POST (:16) | src/app/api/activities/trash/[id]/restore/route.ts |
| `/api/auth/google` | GET (:3) | src/app/api/auth/google/route.ts |
| `/api/auth/google/callback` | GET (:9) | src/app/api/auth/google/callback/route.ts |
| `/api/auth/logout` | POST (:3) | src/app/api/auth/logout/route.ts |
| `/api/auth/shell/token` | POST (:44) | src/app/api/auth/shell/token/route.ts |
| `/api/auth/strava` | GET (:3) | src/app/api/auth/strava/route.ts |
| `/api/auth/strava/callback` | GET (:9) | src/app/api/auth/strava/callback/route.ts |
| `/api/cron/gcal` | GET (:69) | src/app/api/cron/gcal/route.ts |
| `/api/cron/reminders` | GET (:31) | src/app/api/cron/reminders/route.ts |
| `/api/cron/sync-drain` | GET (:28) | src/app/api/cron/sync-drain/route.ts |
| `/api/custom-workouts` | GET (:14), POST (:24) | src/app/api/custom-workouts/route.ts |
| `/api/custom-workouts/[id]` | GET (:28), PUT (:41), DELETE (:81) | src/app/api/custom-workouts/[id]/route.ts |
| `/api/export/activities` | GET (:27) | src/app/api/export/activities/route.ts |
| `/api/export/strength-sets` | GET (:26) | src/app/api/export/strength-sets/route.ts |
| `/api/fitness-estimate` | GET (:11) | src/app/api/fitness-estimate/route.ts |
| `/api/garmin/config` | GET (:15), POST (:27) | src/app/api/garmin/config/route.ts |
| `/api/garmin/import` | POST (:10) | src/app/api/garmin/import/route.ts |
| `/api/garmin/reconcile` | POST (:47) | src/app/api/garmin/reconcile/route.ts |
| `/api/garmin/resync` | POST (:10) | src/app/api/garmin/resync/route.ts |
| `/api/garmin/status` | GET (:9) | src/app/api/garmin/status/route.ts |
| `/api/gcal/disconnect` | POST (:11) | src/app/api/gcal/disconnect/route.ts |
| `/api/geo` | GET (:7) | src/app/api/geo/route.ts |
| `/api/insights` | GET (:15) | src/app/api/insights/route.ts |
| `/api/integrations/gcal/status` | GET (:10) | src/app/api/integrations/gcal/status/route.ts |
| `/api/integrations/strava/status` | GET (:10) | src/app/api/integrations/strava/status/route.ts |
| `/api/pace-insights` | GET (:17) | src/app/api/pace-insights/route.ts |
| `/api/performance` | GET (:57) | src/app/api/performance/route.ts |
| `/api/plan/adjustments` | GET (:61), POST (:135) | src/app/api/plan/adjustments/route.ts |
| `/api/plans` | POST (:53), GET (:400) | src/app/api/plans/route.ts |
| `/api/plans/[id]` | GET (:46), PUT (:116), DELETE (:450) | src/app/api/plans/[id]/route.ts |
| `/api/plans/[id]/recalibrate` | POST (:46) | src/app/api/plans/[id]/recalibrate/route.ts |
| `/api/plans/[id]/skip-week` | GET (:47), POST (:81) | src/app/api/plans/[id]/skip-week/route.ts |
| `/api/plans/[id]/skip-week/undo` | POST (:22) | src/app/api/plans/[id]/skip-week/undo/route.ts |
| `/api/plans/[id]/workouts/[workoutId]` | PATCH (:41) | src/app/api/plans/[id]/workouts/[workoutId]/route.ts |
| `/api/profiles` | GET (:25), POST (:41), DELETE (:82) | src/app/api/profiles/route.ts |
| `/api/push/subscribe` | POST (:43) | src/app/api/push/subscribe/route.ts |
| `/api/push/unsubscribe` | POST (:15) | src/app/api/push/unsubscribe/route.ts |
| `/api/race-times` | GET (:20), POST (:31), DELETE (:89) | src/app/api/race-times/route.ts |
| `/api/readiness` | GET (:28) | src/app/api/readiness/route.ts |
| `/api/reminders/settings` | GET (:30), POST (:39) | src/app/api/reminders/settings/route.ts |
| `/api/session` | GET (:4) | src/app/api/session/route.ts |
| `/api/stats/hr-zones` | GET (:48) | src/app/api/stats/hr-zones/route.ts |
| `/api/strava/backfill` | POST (:21) | src/app/api/strava/backfill/route.ts |
| `/api/strava/disconnect` | POST (:5) | src/app/api/strava/disconnect/route.ts |
| `/api/strava/subscription` | GET (:16), POST (:44) | src/app/api/strava/subscription/route.ts |
| `/api/strava/webhook` | GET (:12), POST (:38) | src/app/api/strava/webhook/route.ts |
| `/api/strength/exercises` | GET (:17) | src/app/api/strength/exercises/route.ts |
| `/api/strength/history/[exerciseId]` | GET (:22) | src/app/api/strength/history/[exerciseId]/route.ts |
| `/api/strength/plan-settings` | GET (:56), PUT (:69), PATCH (:171), DELETE (:253) | src/app/api/strength/plan-settings/route.ts |
| `/api/strength/plan-settings/ensure` | POST (:9) | src/app/api/strength/plan-settings/ensure/route.ts |
| `/api/strength/plan-settings/reconcile` | POST (:11) | src/app/api/strength/plan-settings/reconcile/route.ts |
| `/api/strength/sessions` | GET (:55), POST (:108) | src/app/api/strength/sessions/route.ts |
| `/api/strength/sessions/[id]` | GET (:65), PATCH (:228), DELETE (:472) | src/app/api/strength/sessions/[id]/route.ts |
| `/api/strength/sessions/[id]/garmin` | POST (:28) | src/app/api/strength/sessions/[id]/garmin/route.ts |
| `/api/strength/sessions/[id]/pain` | POST (:17) | src/app/api/strength/sessions/[id]/pain/route.ts |
| `/api/strength/sessions/[id]/sets` | POST (:33), DELETE (:227) | src/app/api/strength/sessions/[id]/sets/route.ts |
| `/api/strength/sessions/[id]/trash` | POST (:15) | src/app/api/strength/sessions/[id]/trash/route.ts |
| `/api/strength/summary` | GET (:30) | src/app/api/strength/summary/route.ts |
| `/api/strength/validate` | POST (:26) | src/app/api/strength/validate/route.ts |
| `/api/sync/gcal` | POST (:11), GET (:32) | src/app/api/sync/gcal/route.ts |
| `/api/sync/health` | GET (:16) | src/app/api/sync/health/route.ts |
| `/api/sync/reconcile-archived-plans` | GET (:28) | src/app/api/sync/reconcile-archived-plans/route.ts |
| `/api/sync/reconcile-garmin` | GET (:57) | src/app/api/sync/reconcile-garmin/route.ts |
| `/api/sync/reconcile-gcal-outbox` | GET (:28) | src/app/api/sync/reconcile-gcal-outbox/route.ts |
| `/api/today` | GET (:11) | src/app/api/today/route.ts |
| `/api/user/device-setup` | GET (:36), PUT (:49) | src/app/api/user/device-setup/route.ts |
| `/api/user/units` | GET (:32), POST (:41) | src/app/api/user/units/route.ts |
| `/api/wellness` | GET (:29), PUT (:58) | src/app/api/wellness/route.ts |
| `/api/workouts/[workoutId]` | GET (:10) | src/app/api/workouts/[workoutId]/route.ts |
| `/api/workouts/[workoutId]/complete` | PATCH (:19) | src/app/api/workouts/[workoutId]/complete/route.ts |
| `/api/workouts/[workoutId]/race-result` | POST (:33), DELETE (:119) | src/app/api/workouts/[workoutId]/race-result/route.ts |
| `/api/workouts/[workoutId]/record` | POST (:32) | src/app/api/workouts/[workoutId]/record/route.ts |

## Screens (`page.tsx`)

Walked from `src/app/` (32 pages). Line count is a stub/real signal only, not a quality one.

| route | lines | file |
|---|---|---|
| `/activities` | 1495 | src/app/activities/page.tsx |
| `/activity` | 1439 | src/app/activity/page.tsx |
| `/create` | 662 | src/app/create/page.tsx |
| `/insights` | 293 | src/app/insights/page.tsx |
| `/pace-insights` | 827 | src/app/pace-insights/page.tsx |
| `/page.tsx` | 2192 | src/app/page.tsx |
| `/plan` | 495 | src/app/plan/page.tsx |
| `/plan/edit` | 522 | src/app/plan/edit/page.tsx |
| `/plan/manage` | 678 | src/app/plan/manage/page.tsx |
| `/plan/overview` | 589 | src/app/plan/overview/page.tsx |
| `/plan/rearrange` | 1595 | src/app/plan/rearrange/page.tsx |
| `/settings` | 297 | src/app/settings/page.tsx |
| `/settings/apps` | 472 | src/app/settings/apps/page.tsx |
| `/settings/export` | 63 | src/app/settings/export/page.tsx |
| `/settings/haptics` | 41 | src/app/settings/haptics/page.tsx |
| `/settings/household` | 84 | src/app/settings/household/page.tsx |
| `/settings/hr-zones` | 255 | src/app/settings/hr-zones/page.tsx |
| `/settings/kraft` | 347 | src/app/settings/kraft/page.tsx |
| `/settings/permissions` | 117 | src/app/settings/permissions/page.tsx |
| `/settings/recording` | 208 | src/app/settings/recording/page.tsx |
| `/settings/reminders` | 150 | src/app/settings/reminders/page.tsx |
| `/settings/rpe` | 143 | src/app/settings/rpe/page.tsx |
| `/settings/sync` | 142 | src/app/settings/sync/page.tsx |
| `/settings/theme` | 47 | src/app/settings/theme/page.tsx |
| `/settings/units` | 122 | src/app/settings/units/page.tsx |
| `/settings/workouts` | 62 | src/app/settings/workouts/page.tsx |
| `/stats` | 1070 | src/app/stats/page.tsx |
| `/strength` | 1971 | src/app/strength/page.tsx |
| `/strength/history` | 586 | src/app/strength/history/page.tsx |
| `/strength/session` | 407 | src/app/strength/session/page.tsx |
| `/strength/setup` | 608 | src/app/strength/setup/page.tsx |
| `/workout` | 1872 | src/app/workout/page.tsx |

## Components

Walked from `src/components/` (57 files). Line count distinguishes a real implementation from a stub without reading each file.

| file | lines |
|---|---|
| `BootSplash.tsx` | 41 |
| `BottomNav.tsx` | 71 |
| `ConnectionSetup.tsx` | 219 |
| `ConnectScreen.tsx` | 64 |
| `FirstRunWalkthrough.tsx` | 131 |
| `GuidedRun.tsx` | 1080 |
| `PaceChart.tsx` | 265 |
| `PermissionPrimer.tsx` | 83 |
| `PermissionsSync.tsx` | 15 |
| `PlanAdjustmentTray.tsx` | 172 |
| `PlanBuildingLoader.tsx` | 170 |
| `PlanErrorScreen.tsx` | 62 |
| `PlanReadyScreen.tsx` | 161 |
| `ProfileAvatar.tsx` | 56 |
| `ReadinessCard.tsx` | 138 |
| `ResumeWorkoutPill.tsx` | 73 |
| `RunMap.tsx` | 79 |
| `SessionProvider.tsx` | 73 |
| `strength/AdjustLoadSheet.tsx` | 126 |
| `strength/CustomWorkoutBuilder.tsx` | 508 |
| `strength/ExerciseActionsSheet.tsx` | 101 |
| `strength/ExercisePicker.tsx` | 208 |
| `strength/GuidedSession.tsx` | 1592 |
| `strength/PrMoment.tsx` | 52 |
| `strength/SessionHeartRate.tsx` | 67 |
| `strength/SessionOverviewCards.tsx` | 126 |
| `strength/SessionPerformedOnWatch.tsx` | 61 |
| `strength/SessionPlannedExercises.tsx` | 94 |
| `strength/SessionSetsList.tsx` | 94 |
| `strength/SessionSkippedExercises.tsx` | 43 |
| `strength/SessionTimeline.tsx` | 57 |
| `strength/SortableItem.tsx` | 40 |
| `strength/SortChips.tsx` | 39 |
| `strength/VideoSheet.tsx` | 38 |
| `strength/WeeklyStrengthPlan.tsx` | 67 |
| `StrengthReadyScreen.tsx` | 128 |
| `ThemeProvider.tsx` | 53 |
| `TimePicker.tsx` | 45 |
| `ui/8bit-switch.tsx` | 52 |
| `ui/Button.tsx` | 81 |
| `ui/feedback.tsx` | 112 |
| `ui/InfoTooltip.tsx` | 68 |
| `ui/KadenzMark.tsx` | 20 |
| `ui/List.tsx` | 91 |
| `ui/NavBar.tsx` | 69 |
| `ui/PullIndicator.tsx` | 20 |
| `ui/Segmented.tsx` | 72 |
| `ui/SettingsSubpage.tsx` | 105 |
| `ui/Sheet.tsx` | 134 |
| `ui/StepperButton.tsx` | 38 |
| `ui/TransitionLink.tsx` | 45 |
| `ui/WheelPicker.tsx` | 141 |
| `ui/wizard.tsx` | 131 |
| `WarmupPlayer.tsx` | 224 |
| `WellnessCheckIn.tsx` | 181 |
| `WorkoutCelebration.tsx` | 90 |
| `WorkoutTypeBadge.tsx` | 56 |

## Design tokens

Parsed from `src/app/globals.css`: `--k-*` and `--vi-*` custom properties in the top-level `:root` (dark) and `html.light` (light) blocks (61 tokens). Element-level overrides (e.g. `.k-dark-surface`) are not tracked here.

| token | dark (`:root`) | light (`html.light`) |
|---|---|---|
| `--k-accent` | #C8FF3D (:60) | #C8FF3D (:166) |
| `--k-accent-fg` | #C8FF3D; /* volt is legible on the ink canvas */ --k-accent-grad: linear-gradient(180deg, #D6FF5E 0%, #B7F52A 100%) (:61) | #3F7000; /* deep green — volt text is illegible on paper */ --k-accent-grad: linear-gradient(180deg, #D6FF5E 0%, #B7F52A 100%) (:167) |
| `--k-bg` | #0B0B0F (:46) | #F4F4EE (:152) |
| `--k-bg-grad` | linear-gradient(180deg, #0F0F14 0%, #08080B 100%) (:47) | linear-gradient(180deg, #F7F7F1 0%, #EEEEE6 100%) (:153) |
| `--k-danger` | #FF5C5C (:77) | #E03A3A (:187) |
| `--k-desk` | #000000 (:132) | #C7C7CC (:203) |
| `--k-elevated` | #1E1E26 (:50) | #ECECE3 (:156) |
| `--k-float` | #1E1E26 (:51) | #FFFFFF (:157) |
| `--k-float-grad` | linear-gradient(180deg, #23232C 0%, #1A1A21 100%) (:52) | linear-gradient(180deg, #FFFFFF 0%, #F4F4EC 100%) (:158) |
| `--k-grad-easy` | linear-gradient(180deg, #FFE14D 0%, #4ADE80 100%) (:97) | not set — falls back to dark |
| `--k-grad-interval` | linear-gradient(180deg, #FF4D4D 0%, #FF8A3D 100%) (:100) | not set — falls back to dark |
| `--k-grad-lift` | linear-gradient(180deg, #5AA0FF 0%, #2563EB 100%) (:103) | not set — falls back to dark |
| `--k-grad-long` | linear-gradient(180deg, #9B6BFF 0%, #7C5CFF 100%) (:101) | not set — falls back to dark |
| `--k-grad-race` | linear-gradient(180deg, #FF4D4D 0%, #FF8A3D 100%) (:102) | not set — falls back to dark |
| `--k-grad-recovery` | linear-gradient(180deg, #4ADE80 0%, #35E4D4 100%) (:98) | not set — falls back to dark |
| `--k-grad-tempo` | linear-gradient(180deg, #FF8A3D 0%, #FFE14D 100%) (:99) | not set — falls back to dark |
| `--k-hairline` | #26262F (:53) | #E2E2D8 (:159) |
| `--k-material` | rgba(20, 20, 25, 0.78) (:135) | rgba(244, 244, 238, 0.78) (:200) |
| `--k-material-border` | rgba(255, 255, 255, 0.08) (:136) | rgba(0, 0, 0, 0.08) (:201) |
| `--k-on-accent` | #0B0B0F (:63) | #0B0B0F (:169) |
| `--k-progress` | #C8FF3D (:66) | #C8FF3D (:172) |
| `--k-progress-2` | #35E4D4 (:67) | #35E4D4 (:173) |
| `--k-ring-hairline` | 0 0 0 0.5px rgba(255, 255, 255, 0.06) (:129) | 0 0 0 0.5px rgba(23, 26, 31, 0.06) (:198) |
| `--k-scrim` | rgba(0, 0, 0, 0.62) (:137) | rgba(11, 11, 15, 0.42) (:202) |
| `--k-shadow-card` | 0 0 0 0.5px rgba(255, 255, 255, 0.06) (:125) | 0 1px 1px rgba(23, 26, 31, 0.03), 0 2px 6px rgba(23, 26, 31, 0.05), 0 8px 24px rgba(23, 26, 31, 0.05) (:190) |
| `--k-shadow-float` | 0 0 0 0.5px rgba(255, 255, 255, 0.08), 0 16px 48px rgba(0, 0, 0, 0.6) (:126) | 0 2px 4px rgba(23, 26, 31, 0.06), 0 8px 20px rgba(23, 26, 31, 0.1), 0 24px 60px rgba(23, 26, 31, 0.16) (:194) |
| `--k-sig-aurora` | linear-gradient(120deg, #C8FF3D 0%, #35E4D4 46%, #7C5CFF 100%) (:74) | not set — falls back to dark |
| `--k-sig-dawn` | linear-gradient(140deg, #FFAB5E 0%, #FF7759 52%, #EF5B7B 100%) (:72) | not set — falls back to dark |
| `--k-sig-kinetic` | linear-gradient(120deg, #C8FF3D 0%, #35E4D4 46%, #7C5CFF 100%) (:73) | not set — falls back to dark |
| `--k-signature-grad` | var(--k-sig-kinetic) (:70) | not set — falls back to dark |
| `--k-signature-ink` | #0B0B0F (:71) | not set — falls back to dark |
| `--k-success` | #34D399 (:78) | #1FA97A (:188) |
| `--k-surface` | #141419 (:48) | #FFFFFF (:154) |
| `--k-surface-grad` | linear-gradient(180deg, #17171D 0%, #111116 100%) (:49) | linear-gradient(180deg, #FFFFFF 0%, #F6F6F0 100%) (:155) |
| `--k-text-1` | #F4F4EE (:55) | #0B0B0F (:161) |
| `--k-text-2` | #A0A0AC (:56) | #565660 (:162) |
| `--k-text-3` | #878B95 (:57) | #646973 (:163) |
| `--k-type-easy` | #4ADE80 (:83) | not set — falls back to dark |
| `--k-type-easy-grad` | var(--k-grad-easy) (:106) | not set — falls back to dark |
| `--k-type-interval` | #FF4D4D (:86) | not set — falls back to dark |
| `--k-type-interval-grad` | var(--k-grad-interval) (:109) | not set — falls back to dark |
| `--k-type-lift` | #5AA0FF (:93) | #2563EB (:177) |
| `--k-type-long` | #C084FC (:87) | not set — falls back to dark |
| `--k-type-long-grad` | var(--k-grad-long) (:110) | not set — falls back to dark |
| `--k-type-race` | #FF4D4D (:89) | not set — falls back to dark |
| `--k-type-race-grad` | var(--k-grad-race) (:111) | not set — falls back to dark |
| `--k-type-recovery` | #4ADE80 (:84) | not set — falls back to dark |
| `--k-type-recovery-grad` | var(--k-grad-recovery) (:107) | not set — falls back to dark |
| `--k-type-strength` | var(--k-type-lift) (:94) | not set — falls back to dark |
| `--k-type-strength-grad` | var(--k-grad-lift) (:112) | not set — falls back to dark |
| `--k-type-tempo` | #FFE14D (:85) | not set — falls back to dark |
| `--k-type-tempo-grad` | var(--k-grad-tempo) (:108) | not set — falls back to dark |
| `--k-volt-grad` | linear-gradient(140deg, #dbff66 0%, #c8ff3c 54%, #a6e52e 100%) (:418) | not set — falls back to dark |
| `--k-warn` | #FFB547 (:76) | #E8850A (:186) |
| `--vi-cyan` | #35E4D4 (:117) | #0C6A62 (:179) |
| `--vi-easy` | #4ADE80 (:118) | #17803D (:180) |
| `--vi-interval` | #FF4D4D (:120) | #C81E1E (:182) |
| `--vi-lift` | #5AA0FF (:122) | #1D4ED8 (:184) |
| `--vi-long` | #C084FC (:121) | #7E3AF2 (:183) |
| `--vi-tempo` | #FFE14D (:119) | #755C00 (:181) |
| `--vi-volt` | #C8FF3D (:116) | #3F6100 (:178) |
