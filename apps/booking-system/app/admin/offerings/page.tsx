import { Suspense } from 'react';
import { getOfferings, getLocations } from '@/lib/supabase/queries';
import { OfferingsManagement } from '@/components/admin/offerings-management';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireAdmin } from '@/lib/utils/route-protection';

export const dynamic = 'force-dynamic';

export default async function OfferingsAdminPage() {
  // Require admin access with full profile completion
  await requireAdmin();
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-4">Offerings Management</h1>
        <p className="text-muted-foreground">
          Create and manage session offerings for your customers
        </p>
      </div>

      <Suspense fallback={<OfferingsLoading />}>
        <OfferingsContent />
      </Suspense>
    </div>
  );
}

async function OfferingsContent() {
  try {
    // Get offerings for the next 60 days and all locations
    const today = new Date().toISOString().split('T')[0];
    const sixtyDaysLater = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const [offerings, locations] = await Promise.all([
      getOfferings({
        dateFrom: today,
        dateTo: sixtyDaysLater,
        includePast: true, // Admin view includes past sessions
      }),
      getLocations(false), // Get all locations including inactive for admin
    ]);

    return <OfferingsManagement initialOfferings={offerings} locations={locations} />;
  } catch (error) {
    console.error('Error fetching data:', error);
    return (
      <Card>
        <CardHeader>
          <CardTitle>Unable to Load Offerings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            We&apos;re having trouble loading the offerings. Please try again later.
          </p>
        </CardContent>
      </Card>
    );
  }
}

function OfferingsLoading() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="h-8 bg-muted rounded w-32 animate-pulse" />
        <div className="h-10 bg-muted rounded w-28 animate-pulse" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((item) => (
          <Card key={item} className="animate-pulse">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="h-4 bg-muted rounded w-16" />
                <div className="h-6 bg-muted rounded w-24" />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                <div className="h-4 bg-muted rounded w-32" />
                <div className="h-4 bg-muted rounded w-48" />
              </div>
              <div className="flex items-center justify-between">
                <div className="h-6 bg-muted rounded w-16" />
                <div className="h-4 bg-muted rounded w-24" />
              </div>
              <div className="flex gap-2">
                <div className="h-8 bg-muted rounded flex-1" />
                <div className="h-8 bg-muted rounded flex-1" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
