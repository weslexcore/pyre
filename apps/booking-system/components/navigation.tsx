import Link from "next/link";
import Image from "next/image";
import { AuthButton } from "@/components/auth-button";
import { hasEnvVars } from "@/lib/utils";
import { EnvVarWarning } from "@/components/env-var-warning";
import { MobileNav } from "@/components/mobile-nav";
import { createClient } from "@/lib/supabase/server";

export async function Navigation() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  let isAdmin = false;
  if (user) {
    const { data: userData } = await supabase
      .from('auth.users')
      .select('is_super_admin')
      .eq('id', user.id)
      .single();
    isAdmin = userData?.is_super_admin || false;
  }
  return (
    <nav className="w-full border-b border-b-foreground/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link href="/" className="flex items-center space-x-2">
              <Image
                src="/assets/logos/pyre-logo.png"
                alt="Pyre"
                width={32}
                height={32}
                className="w-8 h-8"
              />
              {/* <span className="font-semibold text-lg hidden sm:block">
                Pyre
              </span> */}
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-8">
            <Link
              href="/"
              className="text-sm font-medium hover:text-foreground/80 transition-colors"
            >
              Schedule
            </Link>
            {isAdmin && (
              <Link
                href="/admin"
                className="text-sm font-medium hover:text-foreground/80 transition-colors"
              >
                Admin
              </Link>
            )}
          </div>

          {/* Auth Button - Desktop */}
          <div className="hidden md:flex items-center">
            {!hasEnvVars ? <EnvVarWarning /> : <AuthButton />}
          </div>

          {/* Mobile menu */}
          <div className="md:hidden">
            <MobileNav isAdmin={isAdmin} />
          </div>
        </div>
      </div>
    </nav>
  );
}