// AttendedSessionsList component
// Displays user's past sessions with attended/missed status

import { useMemberSessions } from '@/hooks/useMemberSessions';
import { accountConfig } from '@/lib/account-config';
import type { MemberSession } from '@/lib/momence-member-types';

export function AttendedSessionsList() {
  const { sessions, loading, error } = useMemberSessions({ type: 'attended' });

  // Hide entire section while loading, on auth error, or when empty
  if (loading || (error && error !== 'not_authenticated') || sessions.length === 0) {
    return null;
  }

  return (
    <div id="session-history" className="mt-6">
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-6">
        <h2 className="font-mono-bold text-lg uppercase tracking-wide mb-4">
          {accountConfig.attendedSessions.title}
        </h2>
        <div className="space-y-3">
          {sessions.map((session) => (
            <AttendedSessionCard key={session.bookingId} session={session} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AttendedSessionCard({ session }: { session: MemberSession }) {
  const date = new Date(session.dateTime);
  const formattedTime = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  });

  const isAttended = session.status === 'attended';
  const statusLabel = isAttended
    ? accountConfig.attendedSessions.statusLabels.attended
    : accountConfig.attendedSessions.statusLabels.missed;

  return (
    <div className="flex items-start gap-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--card)]">
      {/* Date badge */}
      <div className="flex-shrink-0 w-14 text-center">
        <div className="text-xs font-mono-bold uppercase text-[var(--muted-foreground)]">
          {date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' })}
        </div>
        <div className="text-2xl font-primary-semibold">
          {date.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'America/New_York' })}
        </div>
        <div className="text-xs font-mono-bold uppercase text-[var(--muted-foreground)]">
          {date.toLocaleDateString('en-US', { month: 'short', timeZone: 'America/New_York' })}
        </div>
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <h3 className="font-primary-semibold text-lg truncate">{session.title}</h3>
        <p className="text-sm text-[var(--muted-foreground)]">
          {formattedTime} • {session.location}
        </p>
        {session.teacherName && (
          <p className="text-sm text-[var(--muted-foreground)]">with {session.teacherName}</p>
        )}
      </div>

      {/* Status badge */}
      <div className="flex-shrink-0">
        <span
          className={`inline-block px-3 py-1.5 text-xs font-mono-bold uppercase rounded ${
            isAttended
              ? 'bg-green-900/20 text-green-400'
              : 'bg-[var(--muted-foreground)]/10 text-[var(--muted-foreground)]'
          }`}
        >
          {statusLabel}
        </span>
      </div>
    </div>
  );
}
