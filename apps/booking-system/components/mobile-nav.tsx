'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LogoutButton } from './logout-button';
import { useAuthState } from '@/hooks/use-auth-state';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

export function MobileNav({
  isAdmin: serverIsAdmin,
  isLoggedIn: serverIsLoggedIn,
}: {
  isAdmin: boolean;
  isLoggedIn: boolean;
}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const isSchedulePage = pathname === '/' || pathname?.startsWith('/schedule');

  // Use real-time auth state for optimistic updates
  const { isAuthenticated, user, isLoading } = useAuthState();
  const [isAdmin, setIsAdmin] = useState(serverIsAdmin);
  const [isLoggedIn, setIsLoggedIn] = useState(serverIsLoggedIn);

  // Optimistically update auth state based on client state
  useEffect(() => {
    if (!isLoading) {
      setIsLoggedIn(isAuthenticated);

      // Check if user is admin based on user metadata
      if (user?.user_metadata?.is_super_admin) {
        setIsAdmin(true);
      } else if (!isAuthenticated) {
        setIsAdmin(false);
      }
      // Keep server admin state if client doesn't have metadata
    }
  }, [isAuthenticated, user, isLoading]);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleMobileMenu}
        aria-label="Toggle navigation menu"
      >
        {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>

      {/* Mobile Navigation Menu */}
      {isMobileMenuOpen && (
        <div className="absolute right-0 top-full mt-2 w-48 bg-background border border-border rounded-md shadow-lg z-50">
          <div className="py-2">
            {!isSchedulePage && (
              <Link
                href="/"
                className="block px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Schedule
              </Link>
            )}
            {isAdmin && (
              <Link
                href="/admin"
                className="block px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Admin
              </Link>
            )}
            {isLoggedIn && (
              <Link
                href="/account"
                className="block px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Account
              </Link>
            )}
            <div className="border-t border-border my-2"></div>

            {/* Auth section with loading state */}
            {isLoading ? (
              <div className="px-4 py-2 flex items-center gap-2 text-sm text-muted-foreground">
                <LoadingSpinner size="sm" />
                Loading...
              </div>
            ) : isLoggedIn ? (
              <div className="px-4 py-2 space-y-2">
                <LogoutButton onAfter={() => setIsMobileMenuOpen(false)} />
              </div>
            ) : (
              <div className="px-4 py-2">
                <Link
                  href="/auth/login"
                  className="block text-sm font-medium hover:text-foreground/80 transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Sign in
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
