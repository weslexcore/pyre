export interface Location {
  id: string;
  name: string;
  address: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Offering {
  id: string;
  date: string;
  time: string;
  session_type: string;
  location_id: string;
  cost: number;
  total_slots: number;
  available_slots: number;
  duration_minutes?: number;
  description?: string;
  created_at: string;
  updated_at: string;
  location?: Location;
}

export interface Booking {
  id: string;
  user_id: string;
  offering_id: string;
  booking_date: string;
  status: 'confirmed' | 'cancelled' | 'no-show';
  created_at: string;
  updated_at: string;
  offering?: Offering;
}

export type InsertLocation = Omit<Location, 'id' | 'created_at' | 'updated_at'>;
export type UpdateLocation = Partial<InsertLocation>;

export type InsertOffering = Omit<Offering, 'id' | 'created_at' | 'updated_at' | 'location'>;
export type UpdateOffering = Partial<InsertOffering>;

export type InsertBooking = Omit<
  Booking,
  'id' | 'created_at' | 'updated_at' | 'booking_date' | 'offering'
>;
export type UpdateBooking = Partial<Omit<InsertBooking, 'user_id' | 'offering_id'>>;
