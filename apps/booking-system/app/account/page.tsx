import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserBookings } from "@/lib/supabase/queries";
import { AccountForm } from "@/components/account-form";
import { UpdatePasswordForm } from "@/components/update-password-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function toDateTime(date?: string, time?: string): Date | null {
  if (!date || !time) return null;
  // Expecting date YYYY-MM-DD and time HH:MM
  try {
    return new Date(`${date}T${time}:00`);
  } catch {
    return null;
  }
}

export default async function AccountPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const bookings = await getUserBookings(user.id);

  const now = new Date();
  const upcoming = bookings.filter((b) => {
    const dt = toDateTime(b.offering?.date, b.offering?.time);
    return b.status === 'confirmed' && dt !== null && dt >= now;
  }).sort((a, b) => {
    const ad = toDateTime(a.offering?.date, a.offering?.time)?.getTime() ?? 0;
    const bd = toDateTime(b.offering?.date, b.offering?.time)?.getTime() ?? 0;
    return ad - bd;
  });

  const past = bookings.filter((b) => {
    const dt = toDateTime(b.offering?.date, b.offering?.time);
    return dt !== null && dt < now;
  }).sort((a, b) => {
    const ad = toDateTime(a.offering?.date, a.offering?.time)?.getTime() ?? 0;
    const bd = toDateTime(b.offering?.date, b.offering?.time)?.getTime() ?? 0;
    return bd - ad;
  });

  const initialName = (user.user_metadata as unknown as { full_name: string })?.full_name ?? null;
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 flex flex-col gap-10 w-full max-w-5xl p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <AccountForm initialEmail={user.email ?? ""} initialName={initialName} />
          <UpdatePasswordForm />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Reservations</CardTitle>
            </CardHeader>
            <CardContent>
              {upcoming.length === 0 ? (
                <p className="text-sm text-muted-foreground">No upcoming reservations.</p>
              ) : (
                <ul className="space-y-3">
                  {upcoming.map((b) => (
                    <li key={b.id} className="border rounded-md p-3">
                      <div className="text-sm">
                        <div className="font-mono-bold">
                          {b.offering?.date} at {b.offering?.time}
                        </div>
                        <div>
                          {b.offering?.session_type} @ {b.offering?.location?.name}
                        </div>
                        <div className="text-xs text-muted-foreground">Status: {b.status}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Past Reservations</CardTitle>
            </CardHeader>
            <CardContent>
              {past.length === 0 ? (
                <p className="text-sm text-muted-foreground">No past reservations.</p>
              ) : (
                <ul className="space-y-3">
                  {past.map((b) => (
                    <li key={b.id} className="border rounded-md p-3">
                      <div className="text-sm">
                        <div className="font-mono-bold">
                          {b.offering?.date} at {b.offering?.time}
                        </div>
                        <div>
                          {b.offering?.session_type} @ {b.offering?.location?.name}
                        </div>
                        <div className="text-xs text-muted-foreground">Status: {b.status}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

