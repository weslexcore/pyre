-- Drop table if it exists to avoid conflicts
DROP TABLE IF EXISTS public.bookings CASCADE;

-- Create bookings table
CREATE TABLE public.bookings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    offering_id UUID NOT NULL REFERENCES public.offerings(id) ON DELETE CASCADE,
    booking_date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'no-show')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(user_id, offering_id)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS bookings_user_id_idx ON public.bookings (user_id);
CREATE INDEX IF NOT EXISTS bookings_offering_id_idx ON public.bookings (offering_id);
CREATE INDEX IF NOT EXISTS bookings_status_idx ON public.bookings (status);
CREATE INDEX IF NOT EXISTS bookings_booking_date_idx ON public.bookings (booking_date);

-- Create updated_at trigger for bookings
DROP TRIGGER IF EXISTS bookings_updated_at ON public.bookings;
CREATE TRIGGER bookings_updated_at
    BEFORE UPDATE ON public.bookings
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Create function to automatically update available_slots when bookings change
CREATE OR REPLACE FUNCTION public.update_offering_slots()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle INSERT (new booking)
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'confirmed' THEN
            UPDATE public.offerings 
            SET available_slots = available_slots - 1 
            WHERE id = NEW.offering_id AND available_slots > 0;
        END IF;
        RETURN NEW;
    END IF;
    
    -- Handle UPDATE (status change)
    IF TG_OP = 'UPDATE' THEN
        -- If booking was cancelled or became no-show, add slot back
        IF OLD.status = 'confirmed' AND NEW.status IN ('cancelled', 'no-show') THEN
            UPDATE public.offerings 
            SET available_slots = available_slots + 1 
            WHERE id = NEW.offering_id;
        END IF;
        
        -- If booking was confirmed from cancelled/no-show, remove slot
        IF OLD.status IN ('cancelled', 'no-show') AND NEW.status = 'confirmed' THEN
            UPDATE public.offerings 
            SET available_slots = available_slots - 1 
            WHERE id = NEW.offering_id AND available_slots > 0;
        END IF;
        
        RETURN NEW;
    END IF;
    
    -- Handle DELETE
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'confirmed' THEN
            UPDATE public.offerings 
            SET available_slots = available_slots + 1 
            WHERE id = OLD.offering_id;
        END IF;
        RETURN OLD;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update available slots
DROP TRIGGER IF EXISTS update_offering_slots_trigger ON public.bookings;
CREATE TRIGGER update_offering_slots_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.bookings
    FOR EACH ROW EXECUTE FUNCTION public.update_offering_slots();