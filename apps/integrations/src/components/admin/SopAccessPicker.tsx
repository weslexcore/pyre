// The who-can-do-this control for a single SOP permission (view or edit),
// shared by the library's create form and a document's settings panel so both
// grant access the same way.
//
// A grant is a set of roles plus a set of individually named staff, and the
// picker shows both at once: role checkboxes, then the roster. Admins are
// fixed on — they reach every document regardless, and a checkbox that can't
// change anything would be a lie. Someone already covered by a checked role is
// marked as such rather than hidden, so the list doesn't reshuffle underneath
// an admin as they tick roles.
import { ROLE_LABELS, SOP_ROLES, type SopRole } from '@/lib/sops/levels';

/** One roster member who can be named in a grant (from /api/admin/sops). */
export interface GrantablePerson {
  email: string;
  name: string;
  role: SopRole;
  /** False when they can't open /admin/sops at all, making a grant inert. */
  hasPageAccess: boolean;
}

export interface SopGrant {
  roles: SopRole[];
  emails: string[];
}

const checkboxClass =
  'h-3.5 w-3.5 shrink-0 accent-[var(--pyre-gold)] disabled:opacity-40 cursor-pointer disabled:cursor-default';

/** Admins always have access, so every grant carries them whatever the UI did. */
export function withAdmins(roles: SopRole[]): SopRole[] {
  return roles.includes('admin') ? roles : [...roles, 'admin'];
}

export function SopAccessPicker({
  title,
  hint,
  grant,
  staff,
  disabled,
  onChange,
}: {
  title: string;
  hint?: string;
  grant: SopGrant;
  staff: GrantablePerson[];
  disabled?: boolean;
  onChange: (next: SopGrant) => void;
}) {
  const toggleRole = (role: SopRole) => {
    const roles = grant.roles.includes(role)
      ? grant.roles.filter((r) => r !== role)
      : [...grant.roles, role];
    onChange({ ...grant, roles: withAdmins(roles) });
  };

  const toggleEmail = (email: string) => {
    const emails = grant.emails.includes(email)
      ? grant.emails.filter((e) => e !== email)
      : [...grant.emails, email];
    onChange({ ...grant, emails });
  };

  return (
    <fieldset className="rounded border border-white/10 bg-white/5 p-3">
      <legend className="px-1 font-mono text-[10px] uppercase tracking-wide text-white/40">
        {title}
      </legend>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {SOP_ROLES.map((role) => (
          <label
            key={role}
            className={`flex items-center gap-1.5 text-xs ${
              role === 'admin' ? 'text-white/40' : 'cursor-pointer text-white/70'
            }`}
          >
            <input
              type="checkbox"
              className={checkboxClass}
              checked={role === 'admin' || grant.roles.includes(role)}
              // Unticking admins wouldn't take their access away, so the box
              // says what's true and refuses to pretend otherwise.
              disabled={disabled || role === 'admin'}
              onChange={() => toggleRole(role)}
            />
            {ROLE_LABELS[role]}
            {role === 'admin' && <span className="text-white/30">(always)</span>}
          </label>
        ))}
      </div>

      {staff.length > 0 && (
        <div className="mt-3 border-t border-white/10 pt-2">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wide text-white/30">
            …and these people
          </p>
          <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
            {staff.map((person) => {
              const viaRole = grant.roles.includes(person.role) || person.role === 'admin';
              return (
                <label
                  key={person.email}
                  className="flex cursor-pointer items-center gap-1.5 text-xs text-white/70"
                >
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={grant.emails.includes(person.email)}
                    disabled={disabled}
                    onChange={() => toggleEmail(person.email)}
                  />
                  <span className="truncate">{person.name}</span>
                  {viaRole && (
                    <span className="shrink-0 font-mono text-[10px] text-white/30">
                      via {ROLE_LABELS[person.role].toLowerCase()}
                    </span>
                  )}
                  {!person.hasPageAccess && (
                    // Grants are checked against the page grant too, so this
                    // one would do nothing until /admin/users opens the page
                    // to them.
                    <span
                      className="shrink-0 font-mono text-[10px] text-[var(--pyre-gold)]"
                      title="This person can't open /admin/sops yet — grant them the page in /admin/users."
                    >
                      no SOP page
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {hint && <p className="mt-2 font-mono text-[10px] text-white/30">{hint}</p>}
    </fieldset>
  );
}
