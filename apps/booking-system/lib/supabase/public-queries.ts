import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { Location, Offering } from '../database.types';

async function createPublicClient() {
  const cookieStore = await cookies();
  
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Ignore cookie setting errors for anonymous access
          }
        },
      },
    },
  );
}

// Public location queries (only active locations)
export async function getPublicLocations() {
  const supabase = await createPublicClient();
  
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('active', true)
    .order('name');
  
  if (error) throw error;
  return data as Location[];
}

// Public offering queries (only for active locations)
export async function getPublicOfferings(filters?: {
  dateFrom?: string;
  dateTo?: string;
  locationId?: string;
  sessionType?: string;
}) {
  const supabase = await createPublicClient();
  
  let query = supabase
    .from('offerings')
    .select(`
      *,
      location:locations(*)
    `);
  
  // Always filter out past sessions by combining date and time
  // This ensures only upcoming sessions are shown
  // Examples of what gets filtered:
  // - Session yesterday at any time: EXCLUDED
  // - Session today at 9:00 AM when current time is 3:00 PM: EXCLUDED  
  // - Session today at 6:00 PM when current time is 3:00 PM: INCLUDED
  // - Session tomorrow at any time: INCLUDED
  //
  // TIMEZONE NOTE: Currently uses server's local time. For production, consider:
  // 1. Using business timezone (e.g., America/New_York) consistently
  // 2. Storing timezone info in location records 
  // 3. Using UTC timestamps and converting on display
  const currentDate = new Date().toISOString().split('T')[0];
  const currentTime = new Date().toTimeString().split(' ')[0].substring(0, 5); // HH:MM format
  
  // Filter: (date > today) OR (date = today AND time > current_time)
  query = query.or(`date.gt.${currentDate},and(date.eq.${currentDate},time.gt.${currentTime})`);
  
  if (filters?.dateFrom) {
    // Use the later of the provided dateFrom or today
    const filterDate = filters.dateFrom > currentDate ? filters.dateFrom : currentDate;
    query = query.gte('date', filterDate);
  }
  
  if (filters?.dateTo) {
    query = query.lte('date', filters.dateTo);
  }
  
  if (filters?.locationId) {
    query = query.eq('location_id', filters.locationId);
  }
  
  if (filters?.sessionType) {
    query = query.eq('session_type', filters.sessionType);
  }
  
  const { data, error } = await query.order('date').order('time');
  
  if (error) throw error;
  return data as Offering[];
}

// Get a single offering by ID (public)
export async function getPublicOfferingById(id: string) {
  const supabase = await createPublicClient();
  
  const { data, error } = await supabase
    .from('offerings')
    .select(`
      *,
      location:locations(*)
    `)
    .eq('id', id)
    .single();
  
  if (error) throw error;
  return data as Offering;
}