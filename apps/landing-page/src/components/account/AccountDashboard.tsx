// AccountDashboard component
// Main dashboard layout for authenticated users

import { useAuth } from '@/hooks/useAuth';
import { accountConfig } from '@/lib/account-config';
import { CreditsCard } from './CreditsCard';
import { MemberDataProvider } from './MemberDataProvider';
import { MembershipCard } from './MembershipCard';
import { ProfileCard } from './ProfileCard';
import { AttendedSessionsList } from './AttendedSessionsList';
import { SessionsList } from './SessionsList';

export function AccountDashboard() {
  // Read query params client-side; guard for SSR where window is unavailable
  const searchParams = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
  const error = searchParams.get('error');
  const freshAuth = searchParams.get('auth') === 'success';

  const { isAuthenticated, user, loading, login } = useAuth({ skipCache: freshAuth });

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-[var(--pyre-red)] border-t-transparent" />
      </div>
    );
  }

  // Not authenticated - show login prompt
  if (!isAuthenticated || !user) {
    return (
      <div className="max-w-md mx-auto text-center py-16 px-4">
        {error && (
          <div className="mb-6 p-4 bg-[var(--pyre-red)]/10 border border-[var(--pyre-red)]/20 rounded-lg text-[var(--pyre-red)]">
            {getErrorMessage(error)}
          </div>
        )}

        <h1 className="font-primary-semibold text-3xl mb-2">
          {accountConfig.loginPrompt.title}
        </h1>
        <p className="text-[var(--muted-foreground)] mb-8">
          {accountConfig.loginPrompt.subtitle}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            type="button"
            onClick={() => login()}
            className="inline-flex items-center justify-center px-6 py-3 rounded-md font-mono-bold text-sm uppercase tracking-wide bg-[var(--pyre-red)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
          >
            {accountConfig.loginPrompt.loginButton}
          </button>
          <button
            type="button"
            onClick={() => login({ signup: true })}
            className="inline-flex items-center justify-center px-6 py-3 rounded-md font-mono-bold text-sm uppercase tracking-wide border-2 border-[var(--pyre-black)] text-[var(--pyre-black)] hover:bg-[var(--pyre-black)] hover:text-[var(--pyre-creme)] transition-colors"
          >
            {accountConfig.loginPrompt.signupButton}
          </button>
        </div>
      </div>
    );
  }

  // Authenticated - show dashboard
  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-primary-semibold text-3xl mb-1 text-[var(--pyre-creme)]">
          {accountConfig.dashboard.title}, {user.firstName}
        </h1>
        <p className="text-[var(--muted-foreground)]">
          {accountConfig.dashboard.subtitle}
        </p>
      </div>
      

      {/* Profile card */}
      <div className="mb-6">
        <ProfileCard user={user} />
      </div>

      {/* Membership and Credits grid */}
      <MemberDataProvider>
        <div className="grid gap-6 md:grid-cols-2">
          <div id="membership">
            <MembershipCard />
          </div>

          <div id="credits">
            <CreditsCard />
          </div>
        </div>
      </MemberDataProvider>

      {/* Sessions section */}
      <div id="sessions" className="mt-8">
        <div className="bg-[var(--pyre-black)] border border-[var(--border)] rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono-bold text-lg uppercase tracking-wide text-[var(--pyre-creme)]">
              {accountConfig.sessions.title}
            </h2>
            <a
              href={accountConfig.sessions.getManageUrl(user.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono uppercase text-[var(--pyre-red)] hover:text-[var(--pyre-red)]/80 transition-colors"
            >
              {accountConfig.sessions.manageButton}
            </a>
          </div>
          <SessionsList />
        </div>
      </div>

      {/* Session History section — self-hiding when no past sessions */}
      <AttendedSessionsList />
    </div>
  );
}

function getErrorMessage(error: string): string {
  switch (error) {
    case 'auth_failed':
      return accountConfig.errors.authFailed;
    case 'state_mismatch':
      return accountConfig.errors.stateMismatch;
    case 'token_exchange_failed':
      return accountConfig.errors.tokenExchangeFailed;
    case 'invalid_callback':
      return accountConfig.errors.stateMismatch;
    default:
      return accountConfig.errors.generic;
  }
}
