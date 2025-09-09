'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function ScheduleLink() {
  const pathname = usePathname();
  const isSchedulePage = pathname === '/' || pathname?.startsWith('/schedule');

  if (isSchedulePage) return null;

  return (
    <Link
      href="/"
      className="text-sm font-mono-bold font-medium hover:text-foreground/80 transition-colors"
    >
      SCHEDULE
    </Link>
  );
}
