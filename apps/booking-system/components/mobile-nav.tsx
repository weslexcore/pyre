"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "./logout-button";

export function MobileNav({ isAdmin, isLoggedIn }: { isAdmin: boolean; isLoggedIn: boolean }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const isSchedulePage = pathname === "/" || pathname?.startsWith("/schedule");

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
        {isMobileMenuOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <Menu className="h-5 w-5" />
        )}
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
            <div className="border-t border-border my-2"></div>
            {isLoggedIn ? (
              <div className="px-4 py-2 space-y-2">
                <Link
                  href="/account"
                  className="block text-sm font-medium hover:text-foreground/80 transition-colors"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  Account
                </Link>
                <LogoutButton />
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
