-- Add duration_minutes to offerings with a default of 90 minutes
ALTER TABLE public.offerings
ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 90 CHECK (duration_minutes > 0);

-- No need for indexes on duration at this time

