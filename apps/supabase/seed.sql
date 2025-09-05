-- Seed data for development
-- This file will be run when you run `supabase db reset` or `supabase seed`

-- Insert sample locations
INSERT INTO public.locations (name, address, active) VALUES 
    ('Garden', '1100 Wittleone Dr. Richmond, VA 20301', true),
    ('Westover', '10203 Westover Hills Blvd, Richmond, VA 23233', false); -- Inactive location for testing

-- Get location IDs for reference
DO $$
DECLARE
    garden_id UUID;
    westover_id UUID;
BEGIN
    -- Get location IDs
    SELECT id INTO garden_id FROM public.locations WHERE name = 'Garden';
    SELECT id INTO westover_id FROM public.locations WHERE name = 'Westover Hills';

    -- Insert sample offerings for the next 30 days
    -- Downtown location offerings
    INSERT INTO public.offerings (date, time, session_type, location_id, cost, total_slots, available_slots) VALUES
        (CURRENT_DATE + INTERVAL '1 day', '09:00', 'Social', garden_id, 35.00, 8, 8),
        (CURRENT_DATE + INTERVAL '1 day', '10:30', 'Silent', garden_id, 25.00, 6, 6),
        (CURRENT_DATE + INTERVAL '1 day', '14:00', 'Guided', garden_id, 55.00, 4, 4),
        (CURRENT_DATE + INTERVAL '1 day', '16:00', 'Social', garden_id, 35.00, 8, 5), -- Some slots taken
        (CURRENT_DATE + INTERVAL '1 day', '18:30', 'Silent', garden_id, 25.00, 6, 6),
        
        (CURRENT_DATE + INTERVAL '2 days', '08:00', 'Social', garden_id, 35.00, 8, 8),
        (CURRENT_DATE + INTERVAL '2 days', '11:00', 'Silent', garden_id, 25.00, 6, 4), -- Some slots taken
        (CURRENT_DATE + INTERVAL '2 days', '15:30', 'Guided', garden_id, 55.00, 4, 4),
        (CURRENT_DATE + INTERVAL '2 days', '17:00', 'Social', garden_id, 35.00, 8, 8),
        
    -- Riverside location offerings
        (CURRENT_DATE + INTERVAL '1 day', '10:00', 'Social', westover_id, 40.00, 6, 6),
        (CURRENT_DATE + INTERVAL '1 day', '12:00', 'Silent', westover_id, 30.00, 4, 4),
        (CURRENT_DATE + INTERVAL '1 day', '15:00', 'Guided', westover_id, 65.00, 4, 2), -- Some slots taken
        (CURRENT_DATE + INTERVAL '1 day', '17:30', 'Silent', westover_id, 30.00, 4, 4),
        
        (CURRENT_DATE + INTERVAL '2 days', '09:30', 'Social', westover_id, 40.00, 6, 6),
        (CURRENT_DATE + INTERVAL '2 days', '13:00', 'Silent', westover_id, 30.00, 4, 4),
        (CURRENT_DATE + INTERVAL '2 days', '16:00', 'Guided', westover_id, 65.00, 4, 4),
        
    -- Mountain View location offerings
        (CURRENT_DATE + INTERVAL '1 day', '08:30', 'Social', garden_id, 45.00, 10, 10),
        (CURRENT_DATE + INTERVAL '1 day', '11:30', 'Silent', garden_id, 35.00, 8, 8),
        (CURRENT_DATE + INTERVAL '1 day', '14:30', 'Guided', garden_id, 75.00, 6, 6),
        (CURRENT_DATE + INTERVAL '1 day', '18:00', 'Social', garden_id, 45.00, 10, 7), -- Some slots taken
        
        (CURRENT_DATE + INTERVAL '2 days', '09:00', 'Social', garden_id, 45.00, 10, 10),
        (CURRENT_DATE + INTERVAL '2 days', '12:30', 'Silent', garden_id, 35.00, 8, 8),
        (CURRENT_DATE + INTERVAL '2 days', '16:30', 'Guided', garden_id, 75.00, 6, 6),
        
    -- Weekend offerings (Saturday)
        (CURRENT_DATE + INTERVAL '5 days', '10:00', 'Social', garden_id, 40.00, 10, 10),
        (CURRENT_DATE + INTERVAL '5 days', '12:00', 'Silent', garden_id, 30.00, 8, 8),
        (CURRENT_DATE + INTERVAL '5 days', '14:00', 'Guided', garden_id, 65.00, 6, 6),
        (CURRENT_DATE + INTERVAL '5 days', '16:00', 'Social', garden_id, 40.00, 10, 10),
        (CURRENT_DATE + INTERVAL '5 days', '18:00', 'Silent', garden_id, 30.00, 8, 8),
        
        (CURRENT_DATE + INTERVAL '5 days', '11:00', 'Social', westover_id, 45.00, 8, 8),
        (CURRENT_DATE + INTERVAL '5 days', '13:30', 'Silent', westover_id, 35.00, 6, 6),
        (CURRENT_DATE + INTERVAL '5 days', '16:30', 'Guided', westover_id, 75.00, 4, 4),
        
    -- Sunday offerings
        (CURRENT_DATE + INTERVAL '6 days', '10:30', 'Social', garden_id, 50.00, 12, 12),
        (CURRENT_DATE + INTERVAL '6 days', '13:00', 'Silent', garden_id, 40.00, 10, 10),
        (CURRENT_DATE + INTERVAL '6 days', '15:30', 'Guided', garden_id, 85.00, 8, 8),
        (CURRENT_DATE + INTERVAL '6 days', '18:30', 'Social', garden_id, 50.00, 12, 12);
END $$;

-- Note: In a real application, you would also insert sample bookings and users
-- but since users are managed by Supabase Auth, we'll skip that for the seed data.