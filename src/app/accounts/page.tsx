import { redirect } from 'next/navigation';
import { getCurrentUser, isPlatformStaff } from '@/lib/session';
import AppShell from '@/components/AppShell';
import AccountsClient from '@/components/AccountsClient';

export const dynamic = 'force-dynamic';

/**
 * Server-guarded page. The gate is enforced again inside every API route, so
 * this check is about not rendering a shell to someone who cannot use it —
 * the route handlers, not this, are the security boundary.
 */
export default async function AccountsPage() {
  const user = await getCurrentUser();
  if (!isPlatformStaff(user)) redirect('/login');

  return (
    <AppShell active="accounts" userEmail={user!.email}>
      <AccountsClient />
    </AppShell>
  );
}
