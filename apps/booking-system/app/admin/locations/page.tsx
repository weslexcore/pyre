import { Suspense } from 'react';
import { getLocations } from '@/lib/supabase/queries';
import { LocationsManagement } from '@/components/admin/locations-management';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export default async function LocationsAdminPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-4">Location Management</h1>
        <p className="text-muted-foreground">
          Manage all your business locations and their availability
        </p>
      </div>

      <Suspense fallback={<LocationsLoading />}>
        <LocationsContent />
      </Suspense>
    </div>
  );
}

async function LocationsContent() {
  try {
    const locations = await getLocations(false); // Get all locations, including inactive

    return <LocationsManagement initialLocations={locations} />;
  } catch (error) {
    console.error('Error fetching locations:', error);
    return (
      <Card>
        <CardHeader>
          <CardTitle>Unable to Load Locations</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            We&apos;re having trouble loading the locations. Please try again later.
          </p>
        </CardContent>
      </Card>
    );
  }
}

function LocationsLoading() {
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="h-8 bg-muted rounded w-32 animate-pulse" />
        <div className="h-10 bg-muted rounded w-28 animate-pulse" />
      </div>

      <div className="space-y-4">
        {[1, 2, 3].map((item) => (
          <Card key={item} className="animate-pulse">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <div className="h-5 bg-muted rounded w-48" />
                  <div className="h-4 bg-muted rounded w-64" />
                </div>
                <div className="flex items-center space-x-2">
                  <div className="h-6 bg-muted rounded w-16" />
                  <div className="h-8 bg-muted rounded w-16" />
                  <div className="h-8 bg-muted rounded w-16" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
