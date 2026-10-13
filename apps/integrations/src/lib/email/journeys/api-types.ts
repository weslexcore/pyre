import type { JourneyDefinition } from './schema';

// Shapes the /api/admin/journeys routes return — shared by the routes and the
// admin islands. Client-bundle-safe (types only).

export interface JourneyStatsDto {
  active: number;
  completed: number;
  exited: number;
  sent30d: number;
  delivered30d: number;
  opened30d: number;
  clicked30d: number;
}

export interface JourneySummaryDto {
  id: string;
  name: string;
  enabled: boolean;
  testMode: boolean;
  archived: boolean;
  revision: number;
  updatedAt: string;
  updatedBy: string | null;
  /** Null when the stored definition no longer validates. */
  definition: JourneyDefinition | null;
  definitionError: string | null;
  stats: JourneyStatsDto;
}

export interface JourneyListResponse {
  journeys: JourneySummaryDto[];
  /** False when the shared `journey` template is gated — block emails only reach the whitelist. */
  journeyTemplateLive: boolean;
}

export interface JourneyRevisionDto {
  revision: number;
  name: string;
  definition: unknown;
  editedBy: string | null;
  note: string | null;
  createdAt: string;
}

export interface JourneyDetailResponse {
  journey: JourneySummaryDto;
  revisions: JourneyRevisionDto[];
  /** Momence tag names (lowercased), for suggestions. */
  tags: string[];
  /** Tags the journey names that Momence doesn't have; null = couldn't check. */
  missingTags: string[] | null;
  journeyTemplateLive: boolean;
  /** The signed-in admin, the default test-send recipient. */
  viewerEmail: string;
  whitelist: string[];
}

export interface EnrollmentSendDto {
  stepId: string | null;
  subject: string | null;
  status: string;
  sentAt: string;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  bouncedAt: string | null;
  error: string | null;
}

export interface EnrollmentDto {
  id: string;
  memberId: number;
  email: string;
  status: 'active' | 'completed' | 'exited';
  cycle: number;
  currentStepKey: string | null;
  nextAt: string | null;
  exitReason: string | null;
  enrolledAt: string;
  endedAt: string | null;
  sends: EnrollmentSendDto[];
}

export interface EnrollmentsResponse {
  enrollments: EnrollmentDto[];
  counts: { active: number; completed: number; exited: number };
  truncated: boolean;
}

export interface PreviewResponse {
  subject: string;
  html: string;
  missing: string[];
  values: Record<string, string>;
}

export interface AudienceResponse {
  kind: 'sweep' | 'event' | 'manual';
  scanned: number;
  matched: number;
  totalCandidates: number;
  sample: string[];
  partial: boolean;
}
