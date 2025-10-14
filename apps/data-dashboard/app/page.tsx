import { loadSessions } from "@/lib/data";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable } from "@/components/dashboard/data-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function Page() {
  const sessions = await loadSessions();

  const uniqueSources = new Set(sessions.map((record) => record.source));
  const uniqueLocations = new Set(sessions.map((record) => record.location));

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-4 py-8">
      <section className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Usage dashboard</h1>
        <p className="text-muted-foreground">
          Combine all CSV exports from Framework, Lolu, and Othership into a single source of truth.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sources & locations</CardDescription>
            <CardTitle className="text-2xl">
              {uniqueSources.size} / {uniqueLocations.size}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Distinct data files and operating venues.
          </CardContent>
        </Card>
      </section>

      <section>
        <Tabs defaultValue="table">
          <TabsList>
            <TabsTrigger value="table">Table view</TabsTrigger>
          </TabsList>
          <TabsContent value="table" className="mt-6 border-none p-0">
            <DataTable data={sessions} />
          </TabsContent>
        </Tabs>
      </section>
    </main>
  );
}
