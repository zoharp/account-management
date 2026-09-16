import { redirect } from 'next/navigation';
import { getCurrentUser, isPlatformStaff } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { appVersion } from '@/lib/version';
import Iso27001Client from '@/components/Iso27001Client';

export const dynamic = 'force-dynamic';

export default async function Iso27001Page() {
  const user = await getCurrentUser();
  if (!isPlatformStaff(user)) redirect('/login');

  return (
    <AppShell active="iso27001" userEmail={user!.email} version={appVersion()}>
      <Iso27001Client />
    </AppShell>
  );
}
