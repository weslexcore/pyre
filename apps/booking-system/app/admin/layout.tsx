import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/');
  }

  const { data: userData } = await supabase
    .from('auth.users')
    .select('is_super_admin')
    .eq('id', user.id)
    .single();
  
  if (!userData?.is_super_admin) {
    redirect('/');
  }
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex-shrink-0 flex items-center">
                <Link href="/admin" className="text-xl font-bold text-gray-900 dark:text-white">
                  Admin Panel
                </Link>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                <Link
                  href="/admin/locations"
                  className="border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-300 dark:hover:text-white dark:hover:border-gray-600 whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm"
                >
                  Locations
                </Link>
                <Link
                  href="/admin/offerings"
                  className="border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-300 dark:hover:text-white dark:hover:border-gray-600 whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm"
                >
                  Offerings
                </Link>
                <Link
                  href="/schedule"
                  className="border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-300 dark:hover:text-white dark:hover:border-gray-600 whitespace-nowrap py-2 px-1 border-b-2 font-medium text-sm"
                >
                  View Schedule
                </Link>
              </div>
            </div>
            <div className="flex items-center">
              <Link
                href="/"
                className="text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-white text-sm font-medium"
              >
                ← Back to Site
              </Link>
            </div>
          </div>
        </div>
      </nav>
      
      <main className="py-10">
        <div className="max-w-7xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}