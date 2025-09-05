-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Anyone can view active locations" ON public.locations;
DROP POLICY IF EXISTS "Admins can view all locations" ON public.locations;
DROP POLICY IF EXISTS "Admins can insert locations" ON public.locations;
DROP POLICY IF EXISTS "Admins can update locations" ON public.locations;
DROP POLICY IF EXISTS "Admins can delete locations" ON public.locations;

DROP POLICY IF EXISTS "Anyone can view offerings for active locations" ON public.offerings;
DROP POLICY IF EXISTS "Admins can view all offerings" ON public.offerings;
DROP POLICY IF EXISTS "Admins can insert offerings" ON public.offerings;
DROP POLICY IF EXISTS "Admins can update offerings" ON public.offerings;
DROP POLICY IF EXISTS "Admins can delete offerings" ON public.offerings;

DROP POLICY IF EXISTS "Users can view their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins can view all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can create their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can update their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins can update any booking" ON public.bookings;
DROP POLICY IF EXISTS "Users can delete their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admins can delete any booking" ON public.bookings;

-- Enable Row Level Security on all tables
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Create admin role check function
CREATE OR REPLACE FUNCTION public.is_admin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- For now, we'll use a simple check. In production, you might want to:
    -- 1. Check user metadata for admin role
    -- 2. Check a separate admin_users table
    -- 3. Use custom claims in JWT
    
    -- This is a placeholder - you'll need to implement your admin logic
    -- For development, you can modify this to check specific user IDs
    RETURN EXISTS (
        SELECT 1 FROM auth.users 
        WHERE id = user_id 
        AND raw_user_meta_data->>'role' = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- LOCATIONS POLICIES
-- Allow everyone to read active locations
CREATE POLICY "Anyone can view active locations" ON public.locations
    FOR SELECT USING (active = true);

-- Allow admins to view all locations
CREATE POLICY "Admins can view all locations" ON public.locations
    FOR SELECT USING (public.is_admin(auth.uid()));

-- Allow admins to insert locations
CREATE POLICY "Admins can insert locations" ON public.locations
    FOR INSERT WITH CHECK (public.is_admin(auth.uid()));

-- Allow admins to update locations
CREATE POLICY "Admins can update locations" ON public.locations
    FOR UPDATE USING (public.is_admin(auth.uid()));

-- Allow admins to delete locations
CREATE POLICY "Admins can delete locations" ON public.locations
    FOR DELETE USING (public.is_admin(auth.uid()));

-- OFFERINGS POLICIES
-- Allow everyone to read offerings for active locations
CREATE POLICY "Anyone can view offerings for active locations" ON public.offerings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.locations 
            WHERE locations.id = offerings.location_id 
            AND locations.active = true
        )
    );

-- Allow admins to view all offerings
CREATE POLICY "Admins can view all offerings" ON public.offerings
    FOR SELECT USING (public.is_admin(auth.uid()));

-- Allow admins to insert offerings
CREATE POLICY "Admins can insert offerings" ON public.offerings
    FOR INSERT WITH CHECK (public.is_admin(auth.uid()));

-- Allow admins to update offerings
CREATE POLICY "Admins can update offerings" ON public.offerings
    FOR UPDATE USING (public.is_admin(auth.uid()));

-- Allow admins to delete offerings
CREATE POLICY "Admins can delete offerings" ON public.offerings
    FOR DELETE USING (public.is_admin(auth.uid()));

-- BOOKINGS POLICIES
-- Users can view their own bookings
CREATE POLICY "Users can view their own bookings" ON public.bookings
    FOR SELECT USING (auth.uid() = user_id);

-- Admins can view all bookings
CREATE POLICY "Admins can view all bookings" ON public.bookings
    FOR SELECT USING (public.is_admin(auth.uid()));

-- Users can insert their own bookings (must be authenticated)
CREATE POLICY "Users can create their own bookings" ON public.bookings
    FOR INSERT WITH CHECK (
        auth.uid() = user_id 
        AND auth.uid() IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM public.offerings o
            JOIN public.locations l ON o.location_id = l.id
            WHERE o.id = offering_id 
            AND l.active = true
            AND o.available_slots > 0
        )
    );

-- Users can update their own bookings (limited to status changes)
CREATE POLICY "Users can update their own bookings" ON public.bookings
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Admins can update any booking
CREATE POLICY "Admins can update any booking" ON public.bookings
    FOR UPDATE USING (public.is_admin(auth.uid()));

-- Users can delete their own bookings
CREATE POLICY "Users can delete their own bookings" ON public.bookings
    FOR DELETE USING (auth.uid() = user_id);

-- Admins can delete any booking
CREATE POLICY "Admins can delete any booking" ON public.bookings
    FOR DELETE USING (public.is_admin(auth.uid()));

-- Create view for public schedule (offerings with location info)
CREATE OR REPLACE VIEW public.schedule AS
SELECT 
    o.*,
    l.name as location_name,
    l.address as location_address
FROM public.offerings o
JOIN public.locations l ON o.location_id = l.id
WHERE l.active = true
ORDER BY o.date, o.time;

-- Grant access to the schedule view
GRANT SELECT ON public.schedule TO anon, authenticated;