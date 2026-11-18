// The staff roster the suite signs in as. auth.setup.ts creates every one of
// these (Auth user + staff row) before any spec runs, because the app caches
// the staff table for 30s: someone added mid-run would be refused sign-in
// until the cache expired.

import { defaultProjects } from '@pyre/e2e-utils';
import { ADMIN_TOOLS } from '../src/components/admin/adminTools';

export const PASSWORD = 'e2e-password-1234';

export interface Role {
  email: string;
  displayName: string;
  isAdmin: boolean;
  pages: string[];
  /** storageState file the setup saves once this role has signed in; null = never signed in by setup. */
  storageState: string | null;
}

const state = (name: string) => `e2e/.auth/${name}.json`;

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
  ROSTER_ONLY,
  ...defaultProjects().flatMap((project) =>
    (['link', 'code'] as const).map((purpose) => signInRole(project.name ?? 'default', purpose))
  ),
];
