import { redirect } from 'next/navigation';
import { getCurrentUser, isPlatformStaff } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { appVersion } from '@/lib/version';
import CreditsClient from '@/components/CreditsClient';

export const dynamic = 'force-dynamic';

export default async function CreditsPage() {
  const user = await getCurrentUser();
  if (!isPlatformStaff(user)) redirect('/login');

  return (
    <AppShell active="credits" userEmail={user!.email} version={appVersion()}>
      <CreditsClient />
    </AppShell>
  );
}
