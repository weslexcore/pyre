import { createWebhookLogger } from '@pyre/webhook-core';

const log = createWebhookLogger('Triggers');

// Tiny internal event bus. Producer: the Momence webhook route (bookings).
// The only consumer is the journey engine's event-driven enrollment — kept
// behind a lazy import so webhook cold starts don't pay for the engine until
// a trigger actually fires.
//
// PurchaseTriggerEvent has no producer right now: purchases are captured for
// analytics by lib/purchases/capture.ts (payment-transaction-succeeded
// webhook), which deliberately does not dispatch, so journeys still enroll
// from the first booking. Wiring it up is a one-line change there once the
// email behaviour is wanted.

export interface BookingTriggerEvent {
  type: 'session-booked' | 'session-booking-cancelled';
  memberId: number;
  email: string;
  firstName: string;
  lastName: string;
  sessionId: number;
  sessionBookingId: number;
}

export interface PurchaseTriggerEvent {
  type: 'purchase';
  memberId: number;
  email: string;
  firstName: string;
  lastName: string;
  saleId: number;
  itemType: string;
  itemName: string;
  /** catalog item id — for memberships this is the membership id */
  saleItemId: number;
  unitPrice: string;
}

export type TriggerEvent = BookingTriggerEvent | PurchaseTriggerEvent;
export type TriggerEventType = TriggerEvent['type'];

// Best-effort: trigger fan-out must never fail the producer (a webhook 500
// would cause Momence retries; a poller crash would stall the cursor).
export async function dispatchTrigger(event: TriggerEvent): Promise<void> {
  try {
    const { enrollFromEvent } = await import('@/lib/email/journeys/engine');
    await enrollFromEvent(event);
  } catch (error) {
    log.warn(`Trigger dispatch failed for ${event.type} (member ${event.memberId})`, error);
  }
}
