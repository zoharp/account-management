import { redirect } from 'next/navigation';
import { getCurrentUser, isPlatformStaff } from '@/lib/session';
import AppShell from '@/components/AppShell';
import { appVersion } from '@/lib/version';

export const dynamic = 'force-dynamic';

/**
 * The infrastructure handbook, framed. The deck is its own document with its own
 * full-viewport layout and keyboard navigation, so it lives in an iframe rather
 * than being inlined — its global CSS (`body{overflow:hidden}`, fixed chrome)
 * would otherwise take over the console. See `api/handbook/route.ts`.
 */
export default async function HandbookPage() {
  const user = await getCurrentUser();
  if (!isPlatformStaff(user)) redirect('/login');

  return (
    <AppShell active="handbook" userEmail={user!.email} version={appVersion()}>
      <div className="app-page-header">
        <div>
          <h1>Infrastructure handbook</h1>
          <p className="app-page-sub">
            The whole Orcanos AI setup: apps, hosting, tenancy, residency, auth, cost, LLMs,
            security and how we ship. Click inside the deck and use ← → to move, or M for the
            index. The long-form source is <code>docs/platform/ORCANOS_AI_INFRASTRUCTURE.md</code>.
          </p>
        </div>
        <a className="btn-primary" href="/api/handbook" target="_blank" rel="noopener">
          Open full screen ↗
        </a>
      </div>
      <iframe className="handbook-frame" src="/api/handbook" title="Orcanos AI infrastructure handbook" />
    </AppShell>
  );
}
