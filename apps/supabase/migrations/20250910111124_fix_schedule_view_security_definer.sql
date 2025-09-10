-- Fix SECURITY DEFINER issue with public.schedule view
-- Convert to security_invoker to respect RLS policies and caller permissions

-- Drop existing view first to recreate with security_invoker
DROP VIEW IF EXISTS public.schedule;

-- Recreate view with security_invoker to enforce caller's permissions and RLS
CREATE OR REPLACE VIEW public.schedule 
WITH (security_invoker=on) AS
SELECT 
    o.*,
    l.name as location_name,
    l.address as location_address
FROM public.offerings o
JOIN public.locations l ON o.location_id = l.id
WHERE l.active = true
ORDER BY o.date, o.time;

-- Grant access to the schedule view (same as before)
GRANT SELECT ON public.schedule TO anon, authenticated;

-- Add comment documenting the security fix
COMMENT ON VIEW public.schedule IS 'Public view of active offerings with location info. Uses security_invoker to respect RLS policies.';