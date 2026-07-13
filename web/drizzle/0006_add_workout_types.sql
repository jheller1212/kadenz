-- Add new strength session types (upper_achilles, achilles)
ALTER TYPE strength_session_type ADD VALUE IF NOT EXISTS 'upper_achilles';
--> statement-breakpoint
ALTER TYPE strength_session_type ADD VALUE IF NOT EXISTS 'achilles';
