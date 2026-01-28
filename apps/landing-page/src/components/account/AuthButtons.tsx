// AuthButtons component
// Shows login button or user dropdown based on auth state
// Used as a React island in the Navbar

import { useAuth } from '@/hooks/useAuth';
import { UserDropdown } from './UserDropdown';

interface AuthButtonsProps {
  loginHref?: string;
  loginLabel?: string;
  loginAriaLabel?: string;
  variant?: 'desktop' | 'mobile';
}

export function AuthButtons({
  loginHref = '/api/auth/login',
  loginLabel = 'Login',
  loginAriaLabel = 'Log in to your account',
  variant = 'desktop',
}: AuthButtonsProps) {
  const { isAuthenticated, loading } = useAuth();

  // Show placeholder while loading to prevent layout shift
  if (loading) {
    return (
      <div
        className={`${variant === 'mobile' ? 'w-full' : ''} h-10 px-6 rounded-md bg-[var(--pyre-blue)]/50 animate-pulse`}
        aria-hidden="true"
      />
    );
  }

  // Authenticated - show user dropdown
  if (isAuthenticated) {
    return <UserDropdown variant={variant} />;
  }

  // Not authenticated - show login button
  if (variant === 'mobile') {
    return (
      <a
        href={loginHref}
        aria-label={loginAriaLabel}
        className="w-full inline-flex items-center justify-center px-6 py-3 rounded-md font-mono-bold text-sm uppercase tracking-wide border-2 border-transparent bg-[var(--pyre-blue)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
      >
        {loginLabel}
      </a>
    );
  }

  return (
    <a
      href={loginHref}
      aria-label={loginAriaLabel}
      className="inline-flex items-center justify-center px-6 py-3 rounded-md font-mono-bold text-base uppercase tracking-wide border-2 border-transparent bg-[var(--pyre-blue)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity"
    >
      {loginLabel}
    </a>
  );
}
