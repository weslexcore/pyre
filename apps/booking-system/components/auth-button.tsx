import Link from "next/link";
import { Button } from "./ui/button";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "./logout-button";

export async function AuthButton() {
  const supabase = await createClient();

  // You can also use getUser() which will be slower.
  const { data } = await supabase.auth.getClaims();

  const user = data?.claims;

  return user ? (
    <div className="flex items-center gap-4">
      <span className="font-sans">Hey, {user.email}!</span>
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
