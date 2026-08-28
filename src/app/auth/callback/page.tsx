import { Suspense } from 'react';
import CallbackClient from '@/components/CallbackClient';

export const dynamic = 'force-dynamic';

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="login-wrap">
          <div className="login-card">
            <p className="acl-empty">Signing you in…</p>
          </div>
        </div>
      }
    >
      <CallbackClient />
    </Suspense>
  );
}
