// TODO: Drizzle schema definitions for Postgres
//
// Tables:
//   plans           — id, name, race_distance, goal_time, vdot, start_date, race_date, status, created_at
//   weeks           — id, plan_id, week_number, type (normal|deload|taper|race), total_km, created_at
//   workouts        — id, week_id, day_of_week, date, type (easy|long|tempo|interval|recovery|race), title, status, gcal_event_id, garmin_workout_id, strava_activity_id, created_at
//   blocks          — id, workout_id, order, type (warmup|work|recovery|cooldown), duration_minutes, distance_km, target_pace_min_km, created_at
//   activities      — id, workout_id, strava_id, distance_km, duration_seconds, avg_pace_min_km, avg_hr, splits_json, created_at
//   personal_records — id, distance, time_seconds, date, source, created_at
