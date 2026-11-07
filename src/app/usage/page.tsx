import { redirect } from 'next/navigation';
import { getCurrentUser, isPlatformStaff } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { appVersion } from '@/lib/version';
import UsageClient from '@/components/UsageClient';

export const dynamic = 'force-dynamic';

export default async function UsagePage() {
  const user = await getCurrentUser();
  if (!isPlatformStaff(user)) redirect('/login');

  return (
    <AppShell active="usage" userEmail={user!.email} version={appVersion()}>
      <UsageClient />
    </AppShell>
  );
}
