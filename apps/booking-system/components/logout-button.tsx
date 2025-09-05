"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { sleep } from "@/lib/utils";

export function LogoutButton() {
  const router = useRouter();

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();

    // Small delay to ensure auth cookies clear before re-render
    await sleep(200);

    // Ensure server components re-render with no user
    router.refresh();

    // Optional tiny delay to avoid race during navigation
    await sleep(100);

    router.push("/auth/login");
  };

  return <Button onClick={logout} className="font-mono-bold">LOGOUT</Button>;
}
