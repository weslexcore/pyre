-- Drop table if it exists to avoid constraint conflicts
DROP TABLE IF EXISTS public.offerings CASCADE;

-- Create offerings table
CREATE TABLE public.offerings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    date DATE NOT NULL,
    time TIME NOT NULL,
    session_type TEXT NOT NULL,
    location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    cost DECIMAL(10,2) NOT NULL,
    total_slots INTEGER NOT NULL CHECK (total_slots > 0),
    available_slots INTEGER NOT NULL CHECK (available_slots >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT offerings_slots_constraint CHECK (available_slots <= total_slots)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS offerings_date_idx ON public.offerings (date);
CREATE INDEX IF NOT EXISTS offerings_location_id_idx ON public.offerings (location_id);
CREATE INDEX IF NOT EXISTS offerings_session_type_idx ON public.offerings (session_type);
CREATE INDEX IF NOT EXISTS offerings_date_time_idx ON public.offerings (date, time);

-- Create updated_at trigger for offerings
DROP TRIGGER IF EXISTS offerings_updated_at ON public.offerings;
CREATE TRIGGER offerings_updated_at
    BEFORE UPDATE ON public.offerings
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();