import type { Assignable } from '@/lib/boards/people';
import type { PeopleNames } from '@/lib/sops/names';

/**
 * The fallback owner list for a single-board grantee, who is not handed the
 * roster: the people already named on this board. Enough to filter by and to
 * reassign between, without turning a pipeline grant into a staff directory.
 */
export function namesAsOwners(people: PeopleNames): Assignable[] {
  return Object.entries(people)
    .map(([email, name]) => ({ email, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
