import Link from 'next/link';
import { unstable_noStore as noStore } from 'next/cache';
import Image from 'next/image';
import { AuthButton } from '@/components/auth-button';
import { hasEnvVars } from '@/lib/utils';
import { EnvVarWarning } from '@/components/env-var-warning';
import { MobileNav } from '@/components/mobile-nav';
import { createClient } from '@/lib/supabase/server';
import { ScheduleLink } from '@/components/schedule-link';
import { ThemeSwitcher } from './theme-switcher';

export async function Navigation() {
  // Ensure this server component is never cached
  noStore();
  const supabase = await createClient();
  // Use getClaims for reliability in SSR
  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims ?? null;
  const userId = (user as { sub?: string } | null)?.sub ?? null;

  let isAdmin = false;
  if (userId) {
    const { data: userData } = await supabase
      .from('auth.users')
      .select('is_super_admin')
      .eq('id', userId)
      .single();
    isAdmin = userData?.is_super_admin || false;
  }
  return (
    <nav className="w-full border-b border-b-foreground/10">
      <div className="mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative flex justify-between items-center h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center space-x-2">
            <Image
              src="/assets/logos/pyre-logo.png"
              alt="Pyre"
              width={32}
              height={32}
              className="w-8 h-8"
            />
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8 absolute left-1/2 -translate-x-1/2">
            <ScheduleLink />
            {isAdmin && (
              <Link
                href="/admin"
                className="text-sm font-mono-bold font-medium hover:text-foreground/80 transition-colors"
              >
                Admin
              </Link>
            )}
          </div>

          {/* Auth Button - Desktop */}
          <div className="hidden md:flex items-center gap-2">
            <ThemeSwitcher />
            {!hasEnvVars ? <EnvVarWarning /> : <AuthButton />}
          </div>

          {/* Mobile menu */}
          <div className="md:hidden flex">
            <ThemeSwitcher />
            <MobileNav isAdmin={isAdmin} isLoggedIn={!!userId} />
          </div>
        </div>
      </div>
    </nav>
  );
}
