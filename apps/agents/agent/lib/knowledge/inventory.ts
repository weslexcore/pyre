// Pyre Agent's inventory read: the supplies list as /admin/inventory shows
// it — what is in stock, what is low, what is due for a count, how fast each
// item goes, who last counted it and where they said so — filtered by a
// search or a filter. Goes through the integrations app's /api/agent/pyre as
// the person (./boards callPyre), which checks they hold the page. Changes
// are proposals (propose_inventory_update, propose_inventory_item in
// tools/role_tools.ts) through the same propose() the board tools use.

import { callPyre } from './boards';
import type { KnowledgeScope } from '../role';

export interface InventoryQuery {
  query?: string;
  /** low = at or below its re-order level; due = due for a count; inactive = set aside. */
  filter?: 'all' | 'low' | 'due' | 'inactive';
  category?: string;
  limit?: number;
}

export function getInventory(scope: KnowledgeScope, input: InventoryQuery) {
  return callPyre(scope, null, 'inventory', input as Record<string, unknown>);
}
