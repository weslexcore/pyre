// TypeScript types for Momence Member API responses
// Used for sessions, memberships, and credits

/**
 * A booked session from the member's perspective
 */
export interface MemberSession {
  id: number;
  bookingId: number;
  eventId: number;
  title: string;
  description?: string;
  dateTime: string; // ISO 8601
  duration: number; // minutes
  location: string;
  teacherName?: string;
  status: 'confirmed' | 'pending' | 'cancelled' | 'attended' | 'no_show';
  canCancel: boolean;
  cancelDeadline?: string; // ISO 8601
  image?: string;
  link?: string;
}

/**
 * Active membership details
 */
export interface MemberMembership {
  id: number;
  name: string;
  description?: string;
  status: 'active' | 'paused' | 'cancelled' | 'expired';
  startDate: string; // ISO 8601
  endDate?: string; // ISO 8601, null for unlimited
  renewalDate?: string; // ISO 8601
  autoRenew: boolean;
  credits?: {
    total: number;
    used: number;
    remaining: number;
    unlimited: boolean;
  };
  benefits?: string[];
}

/**
 * Available credits/sessions for booking
 */
export interface MemberCredits {
  available: number;
  unlimited: boolean;
  expiresAt?: string; // ISO 8601
  source?: string; // e.g., "Monthly Membership", "10-Pack"
}

/**
 * Booking request payload
 */
export interface BookSessionRequest {
  eventId: number;
  useCredits: boolean;
}

/**
 * Booking response
 */
export interface BookSessionResponse {
  success: boolean;
  bookingId?: number;
  message?: string;
  checkoutUrl?: string; // If credits not available, redirect here
  waitlisted?: boolean;
}

/**
 * Cancel booking response
 */
export interface CancelBookingResponse {
  success: boolean;
  message?: string;
  creditsRefunded?: number;
}

/**
 * API response wrapper for member endpoints
 */
export interface MemberApiResponse<T> {
  data: T;
  error?: string;
}
