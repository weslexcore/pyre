import { createSupabaseServerClient } from '@/libs/supabase/supabase-server-client';
import { SubscriptionWithProduct } from '@/features/pricing/types';

export async function getSubscription(): Promise<SubscriptionWithProduct | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('subscriptions')
    .select('*, prices(*, products(*))')
    .in('status', ['trialing', 'active'])
    .maybeSingle();

  if (error) {
    console.error(error);
    return null;
  }

  return data as SubscriptionWithProduct | null;
}
