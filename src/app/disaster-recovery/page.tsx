import { redirect } from 'next/navigation';
import { getCurrentUser, isPlatformStaff } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { appVersion } from '@/lib/version';
import BackupsClient from '@/components/BackupsClient';

export const dynamic = 'force-dynamic';

export default async function DisasterRecoveryPage() {
  const user = await getCurrentUser();
  if (!isPlatformStaff(user)) redirect('/login');

  return (
    <AppShell active="disaster-recovery" userEmail={user!.email} version={appVersion()}>
      <BackupsClient />
    </AppShell>
  );
}
