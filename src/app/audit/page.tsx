import { redirect } from 'next/navigation';
import { getCurrentUser, isPlatformStaff } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { appVersion } from '@/lib/version';
import AuditClient from '@/components/AuditClient';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const user = await getCurrentUser();
  if (!isPlatformStaff(user)) redirect('/login');

  return (
    <AppShell active="audit" userEmail={user!.email} version={appVersion()}>
      <AuditClient />
    </AppShell>
  );
}
