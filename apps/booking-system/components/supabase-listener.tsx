"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Listens to Supabase auth state changes and refreshes the router so that
 * server components (like the navigation bar) re-render with the latest user.
 */
export function SupabaseAuthListener() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange(() => {
      console.log("Supabase auth state changed");
      // Refresh RSC payload so server components pick up new cookies/session
      router.refresh();
    });

    return () => {
      data?.subscription?.unsubscribe();
    };
  }, [router]);

  return null;
}
