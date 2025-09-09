import { CompleteProfileForm } from '@/components/complete-profile-form';
import { requireEmailConfirmation } from '@/lib/utils/route-protection';

export default async function CompleteProfilePage() {
  // Ensure user is authenticated and email is confirmed before showing profile completion
  await requireEmailConfirmation();

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <CompleteProfileForm />
      </div>
    </div>
  );
}