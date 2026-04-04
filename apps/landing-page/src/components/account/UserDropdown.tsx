// UserDropdown component
// Navbar dropdown for authenticated users

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { accountConfig } from '@/lib/account-config';

interface UserDropdownProps {
  variant?: 'desktop' | 'mobile';
}

export function UserDropdown({ variant = 'desktop' }: UserDropdownProps) {
  const { user, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const toggleDropdown = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleLogout = useCallback(() => {
    setIsOpen(false);
    logout({ returnUrl: '/' });
  }, [logout]);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  if (!user) return null;

  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`;

  const isMobile = variant === 'mobile';

  const menuItems = (
    <>
      <a
        href="/account"
        className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--pyre-creme)] hover:bg-[var(--pyre-creme)]/10 transition-colors"
        onClick={() => setIsOpen(false)}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
        {accountConfig.dropdown.accountLabel}
      </a>

      <a
        href="/account#sessions"
        className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--pyre-creme)] hover:bg-[var(--pyre-creme)]/10 transition-colors"
        onClick={() => setIsOpen(false)}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        {accountConfig.dropdown.sessionsLabel}
      </a>

      <div className="border-t border-[var(--pyre-creme)]/10 my-1" />

      <button
        type="button"
        onClick={handleLogout}
        className="flex items-center gap-2 w-full px-4 py-2 text-sm text-[var(--pyre-creme)] hover:bg-[var(--pyre-creme)]/10 transition-colors"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
          />
        </svg>
        {accountConfig.dropdown.logoutLabel}
      </button>
    </>
  );

  return (
    <div ref={dropdownRef} className={isMobile ? 'w-full' : 'relative'}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={toggleDropdown}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className={
          isMobile
            ? 'flex items-center justify-center gap-2 w-full px-6 py-3 rounded-md bg-[var(--pyre-blue)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity'
            : 'flex items-center gap-2 px-3 py-2 rounded-md bg-[var(--pyre-blue)] text-[var(--pyre-creme)] hover:opacity-90 transition-opacity'
        }
      >
        <span className="w-7 h-7 rounded-full bg-[var(--pyre-creme)]/20 flex items-center justify-center text-sm font-mono-bold">
          {initials}
        </span>
        <span
          className={
            isMobile
              ? 'font-mono-bold text-sm uppercase tracking-wide'
              : 'hidden sm:inline font-mono-bold text-sm uppercase tracking-wide'
          }
        >
          {user.firstName}
        </span>
        {/* Chevron */}
        <svg
          className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {isOpen &&
        (isMobile ? (
          <div className="mt-2 rounded-md border border-[var(--pyre-creme)]/10 bg-[var(--pyre-black)] overflow-hidden">
            <div className="py-1">{menuItems}</div>
          </div>
        ) : (
          <div className="absolute right-0 mt-2 w-48 bg-[var(--pyre-black)] rounded-md shadow-lg border border-[var(--pyre-creme)]/10 overflow-hidden z-50">
            <div className="py-1">{menuItems}</div>
          </div>
        ))}
    </div>
  );
}
