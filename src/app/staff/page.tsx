import { redirect } from 'next/navigation';
import { getCurrentUser, isPlatformStaff } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { appVersion } from '@/lib/version';
import StaffClient from '@/components/StaffClient';

export const dynamic = 'force-dynamic';

export default async function StaffPage() {
  const user = await getCurrentUser();
  if (!isPlatformStaff(user)) redirect('/login');

  return (
    <AppShell active="staff" userEmail={user!.email} version={appVersion()}>
      <StaffClient />
    </AppShell>
  );
}
