import { redirect } from 'next/navigation';
import { getCurrentUser, isPlatformStaff } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { appVersion } from '@/lib/version';
import PresentationsClient from '@/components/PresentationsClient';

export const dynamic = 'force-dynamic';

export default async function PresentationsPage() {
  const user = await getCurrentUser();
  if (!isPlatformStaff(user)) redirect('/login');

  return (
    <AppShell active="presentations" userEmail={user!.email} version={appVersion()}>
      <PresentationsClient />
    </AppShell>
  );
}
