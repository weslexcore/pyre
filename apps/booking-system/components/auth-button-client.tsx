'use client';

import Link from 'next/link';
import { Button } from './ui/button';
import { LogoutButton } from './logout-button';
import { useAuthState } from '@/hooks/use-auth-state';
import { useEffect, useState } from 'react';

export function AuthButtonClient() {
  const { isAuthenticated, isLoading } = useAuthState();
  const [mounted, setMounted] = useState(false);

  // Avoid hydration mismatches by rendering a stable placeholder until mounted
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex gap-2">
        <Button size="lg" variant={'outline'} className="font-mono-bold" disabled>
          LOADING...
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex gap-2">
        <Button size="lg" variant={'outline'} className="font-mono-bold" disabled>
          LOADING...
        </Button>
      </div>
    );
  }

  return isAuthenticated ? (
    <div className="flex items-center gap-4">
      <Button asChild size="lg" variant={'outline'} className="font-mono-bold">
        <Link href="/account" className="font-mono-bold hover:opacity-80">
          ACCOUNT
        </Link>
      </Button>
      <LogoutButton />
    </div>
  ) : (
    <div className="flex gap-2">
      <Button asChild size="lg" variant={'outline'} className="font-mono-bold">
        <Link href="/auth/login">SIGN IN</Link>
      </Button>
      <Button asChild size="lg" variant={'default'} className="font-mono-bold">
        <Link href="/auth/sign-up">SIGN UP</Link>
      </Button>
    </div>
  );
}
