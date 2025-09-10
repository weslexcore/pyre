-- Fix SECURITY DEFINER and search_path issues with database functions
-- This addresses security vulnerabilities where functions don't have fixed search_path

-- Fix 1: handle_updated_at function
-- Add SECURITY DEFINER and fixed search_path for trigger function
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = '' AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;

-- Fix 2: update_offering_slots function  
-- Add SECURITY DEFINER and fixed search_path for trigger function
CREATE OR REPLACE FUNCTION public.update_offering_slots()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = '' AS $$
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
$$;

-- Fix 3: is_admin function
-- Add fixed search_path (already has SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_admin(user_id UUID)
RETURNS BOOLEAN 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = '' AS $$
BEGIN
    -- Check user metadata for admin role
    RETURN EXISTS (
        SELECT 1 FROM auth.users 
        WHERE id = user_id 
        AND raw_user_meta_data->>'role' = 'admin'
    );
END;
$$;

-- Security: Restrict function execution to appropriate roles
-- Trigger functions are automatically called by triggers, no direct execution needed
-- Admin function should only be callable by authenticated users
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_offering_slots() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(UUID) FROM anon;

-- Grant execute to authenticated users for is_admin (needed for RLS policies)
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;

-- Add comments documenting the security fixes
COMMENT ON FUNCTION public.handle_updated_at() IS 'Trigger function to update updated_at timestamp. Uses SECURITY DEFINER with fixed search_path for security.';
COMMENT ON FUNCTION public.update_offering_slots() IS 'Trigger function to manage offering slot availability. Uses SECURITY DEFINER with fixed search_path for security.';
COMMENT ON FUNCTION public.is_admin(UUID) IS 'Checks if user has admin role via metadata. Uses SECURITY DEFINER with fixed search_path for security.';