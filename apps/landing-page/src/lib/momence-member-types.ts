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
 * Momence v2 /member/sessions response shape
 */
export interface MomenceSessionsResponse {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  payload: MomenceBookingPayload[];
}

/**
 * A single booking entry from Momence /member/sessions
 */
export interface MomenceBookingPayload {
  id: number;
  cancelledAt: string | null;
  checkedIn: boolean;
  session: MomenceSessionDetail;
}

/**
 * The nested session object inside a booking payload
 */
export interface MomenceSessionDetail {
  id: number;
  name: string;
  startsAt: string; // ISO 8601
  endsAt: string; // ISO 8601
  duration: number; // minutes
  description?: string;
  teacherName?: string;
  image1?: string;
  link?: string;
  inPersonLocation?: {
    id: number;
    name: string;
  };
}

/**
 * Momence v2 /member/bought-memberships/active response shape
 */
export interface MomenceBoughtMembershipsResponse {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  payload: MomenceBoughtMembershipPayload[];
}

/**
 * A single bought-membership entry from Momence /member/bought-memberships/active
 */
export interface MomenceBoughtMembershipPayload {
  id: number;
  type: string;
  startDate: string; // ISO 8601
  endDate: string | null;
  isFrozen: boolean;
  eventCreditsLeft: number | null;
  eventCreditsTotal: number | null;
  combinedUsageLimit: number | null;
  combinedUsage: number | null;
  membership: MomenceHostMembershipBasic;
}

/**
 * Nested membership (the host-defined plan) inside a bought-membership payload
 */
export interface MomenceHostMembershipBasic {
  name: string;
  description?: string;
  autoRenewing: boolean;
}

/**
 * API response wrapper for member endpoints
 */
export interface MemberApiResponse<T> {
  data: T;
  error?: string;
}
