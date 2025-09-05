import Link from "next/link";
import { Button } from "./ui/button";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

export async function AuthButton() {
  const supabase = await createClient();
  // Prefer claims for SSR correctness; derive userId from sub
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;
  const userId = (claims as { sub?: string } | null)?.sub ?? null;

  return userId ? (
    <div className="flex items-center gap-4">
      <Button asChild size="lg" variant={"outline"} className="font-mono-bold">
        <Link
          href="/account"
          className="font-mono-bold hover:opacity-80"
        >
          ACCOUNT
        </Link>
      </Button>
      <LogoutButton />
    </div>
  ) : (
    <div className="flex gap-2">
      <Button asChild size="lg" variant={"outline"} className="font-mono-bold">
        <Link href="/auth/login">SIGN IN</Link>
      </Button>
      <Button asChild size="lg" variant={"default"} className="font-mono-bold">
        <Link href="/auth/sign-up">SIGN UP</Link>
      </Button>
    </div>
  );
}
