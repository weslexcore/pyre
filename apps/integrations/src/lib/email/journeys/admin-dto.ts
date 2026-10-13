import type { JourneyRow } from '@/lib/db';
import type { JourneyStats } from './admin';
import type { JourneySummaryDto } from './api-types';
import { toRecord } from './store';

// Row -> DTO for the /api/admin/journeys routes and the server-rendered pages.

const ZERO: JourneyStats = {
  active: 0,
  completed: 0,
  exited: 0,
  sent30d: 0,
  delivered30d: 0,
  opened30d: 0,
  clicked30d: 0,
};

export function toSummary(row: JourneyRow, stats?: JourneyStats): JourneySummaryDto {
  const { record, error } = toRecord(row);
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    testMode: row.test_mode,
    archived: row.archived,
    revision: row.revision,
    sortOrder: row.sort_order ?? 0,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    definition: record?.definition ?? null,
    definitionError: error,
    stats: stats ?? ZERO,
  };
}
