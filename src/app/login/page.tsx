import { redirect } from 'next/navigation';
import { getCurrentUser, isPlatformStaff } from '@/lib/session';
import LoginClient from '@/components/LoginClient';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (isPlatformStaff(user)) redirect('/accounts');
  return <LoginClient />;
}
