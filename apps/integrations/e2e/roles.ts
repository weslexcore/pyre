// The staff roster the suite signs in as. auth.setup.ts creates every one of
// these (Auth user + staff row) before any spec runs, because the app caches
// the staff table for 30s: someone added mid-run would be refused sign-in
// until the cache expired.

import { defaultProjects } from '@pyre/e2e-utils';
import {
  ADMIN_TOOLS,
  GUESTS_MANAGE,
  INVENTORY_MANAGE,
  SCHEDULE_MANAGE,
} from '../src/components/admin/adminTools';
import { APP_PORT } from './ports';

export const PASSWORD = 'e2e-password-1234';

/** The off-shift duty auth.setup.ts adds to the catalog, for schedule drafts to hand out. */
export const OFF_SHIFT_DUTY = { key: 'e2e_off_shift', label: 'E2E carboys' } as const;

export interface Role {
  email: string;
  displayName: string;
  isAdmin: boolean;
  pages: string[];
  /** Shift lead on the roster (SOP grants can name the shift_lead role). */
  isShiftLead?: boolean;
  /** storageState file the setup saves once this role has signed in; null = never signed in by setup. */
  storageState: string | null;
}

// Per app port, so side-by-side runs (E2E_APP_PORT) don't overwrite each
// other's sessions.
const state = (name: string) => `e2e/.auth/${APP_PORT}/${name}.json`;

/** The pages the floor staff use day to day. */
export const STAFF_PAGES = [
  '/admin/schedule',
  '/admin/sops',
  '/admin/shift-notes',
  '/admin/water',
  '/admin/inventory',
  '/admin/guests',
];

export const ADMIN: Role = {
  email: 'e2e-admin@e2e.test',
  displayName: 'Avery Admin',
  isAdmin: true,
  // Admins hold pages like everyone else; admin only unlocks the manage side.
  pages: ADMIN_TOOLS.map((tool) => tool.href),
  storageState: state('admin'),
};

/** Staff with one page: the water log. */
export const WATER_STAFF: Role = {
  email: 'e2e-water@e2e.test',
  displayName: 'Wren Water',
  isAdmin: false,
  pages: ['/admin/water'],
  storageState: state('water'),
};

/** Floor staff: the day-to-day pages, nothing to manage. */
export const STAFF: Role = {
  email: 'e2e-staff@e2e.test',
  displayName: 'Sam Staff',
  isAdmin: false,
  pages: STAFF_PAGES,
  storageState: state('staff'),
};

/** A second floor staff member: the other side of subs, swaps, mentions and audiences. */
export const STAFF_2: Role = {
  email: 'e2e-staff2@e2e.test',
  displayName: 'Casey Crew',
  isAdmin: false,
  pages: STAFF_PAGES,
  storageState: state('staff2'),
};

/** A shift lead: staff pages plus the shift_lead SOP role. No extra grants. */
export const SHIFT_LEAD: Role = {
  email: 'e2e-lead@e2e.test',
  displayName: 'Lee Lead',
  isAdmin: false,
  isShiftLead: true,
  pages: STAFF_PAGES,
  storageState: state('lead'),
};

/** Not an admin, but manages the schedule, inventory and guest profile fields. */
export const MANAGER: Role = {
  email: 'e2e-manager@e2e.test',
  displayName: 'Morgan Manager',
  isAdmin: false,
  pages: [...STAFF_PAGES, SCHEDULE_MANAGE, INVENTORY_MANAGE, GUESTS_MANAGE],
  storageState: state('manager'),
};

/**
 * Pyre Agent's schedule drafts (pyre-agent-schedule.spec.ts): a schedule
 * manager who is not an admin and holds no boards, so the drafting tools
 * stand on schedule:manage alone.
 */
export const SCHEDULER: Role = {
  email: 'e2e-scheduler@e2e.test',
  displayName: 'Skyler Scheduler',
  isAdmin: false,
  pages: ['/admin/ask', '/admin/schedule', SCHEDULE_MANAGE],
  storageState: state('scheduler'),
};

/** Sees the schedule and uses Pyre Agent, but cannot manage the schedule. */
export const SCHEDULE_VIEWER: Role = {
  email: 'e2e-schedule-viewer@e2e.test',
  displayName: 'Vic Viewer',
  isAdmin: false,
  pages: ['/admin/ask', '/admin/schedule'],
  storageState: state('schedule-viewer'),
};

/** On the roster (scheduled) but with no dashboard access. */
export const ROSTER_ONLY: Role = {
  email: 'e2e-roster@e2e.test',
  displayName: 'Rory Roster',
  isAdmin: false,
  pages: [],
  storageState: state('roster'),
};

export type SignInPurpose = 'link' | 'code';

/**
 * One per device project and sign-in test, for the specs that read their
 * email from Mailpit: tests run in parallel, so each needs its own inbox.
 */
export function signInRole(projectName: string, purpose: SignInPurpose): Role {
  return {
    email: `e2e-signin-${purpose}-${projectName}@e2e.test`,
    displayName: `Sasha Signin`,
    isAdmin: false,
    pages: ['/admin/water'],
    storageState: null,
  };
}

export const ROLES: Role[] = [
  ADMIN,
  WATER_STAFF,
  STAFF,
  STAFF_2,
  SHIFT_LEAD,
  MANAGER,
  SCHEDULER,
  SCHEDULE_VIEWER,
  ROSTER_ONLY,
  ...defaultProjects().flatMap((project) =>
    (['link', 'code'] as const).map((purpose) => signInRole(project.name ?? 'default', purpose))
  ),
];
