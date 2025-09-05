"use client";

import { createBrowserClient } from '@supabase/ssr';
import type { Offering } from '../database.types';

function createPublicBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export interface OfferingFilters {
  locationId?: string;
  sessionType?: string;
  dateFrom?: string;
  dateTo?: string;
}

// Client-side query for infinite scroll with pagination
export async function getOfferingsInfinite(
  page: number = 0, 
  pageSize: number = 10,
  filters?: OfferingFilters
) {
  const supabase = createPublicBrowserClient();
  
  let query = supabase
    .from('offerings')
    .select(`
      id,
      date,
      time,
      session_type,
      duration_minutes,
      location_id,
      cost,
      total_slots,
      available_slots,
      description,
      created_at,
      updated_at,
      location:locations(*)
    `, { count: 'exact' });
  
  // Always filter out past sessions by combining date and time
  const currentDate = new Date().toISOString().split('T')[0];
  const currentTime = new Date().toTimeString().split(' ')[0].substring(0, 5);
  
  // Filter: (date > today) OR (date = today AND time > current_time)
  query = query.or(`date.gt.${currentDate},and(date.eq.${currentDate},time.gt.${currentTime})`);
  
  // Apply additional filters
  if (filters?.dateFrom) {
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
  
  // Add pagination
  const from = page * pageSize;
  const to = from + pageSize - 1;
  
  const { data, error, count } = await query
    .order('date')
    .order('time')
    .range(from, to);
  
  if (error) throw error;
  
  return {
    data: (data || []) as unknown as Offering[],
    count: count || 0,
    hasMore: count ? (from + pageSize) < count : false,
    nextPage: page + 1
  };
}

// Get session types for filtering
export async function getSessionTypes() {
  const supabase = createPublicBrowserClient();
  
  const { data, error } = await supabase
    .from('offerings')
    .select('session_type')
    .order('session_type');
    
  if (error) throw error;
  
  // Get unique session types - filtering by active locations happens in the main query
  const uniqueTypes = [...new Set(data.map(item => item.session_type))];
  return uniqueTypes;
}

// Get active locations for filtering
export async function getActiveLocations() {
  const supabase = createPublicBrowserClient();
  
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('active', true)
    .order('name');
    
  if (error) throw error;
  return data;
}
