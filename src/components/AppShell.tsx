'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import OrcanosLogo from './OrcanosLogo';

/**
 * The standing chrome. In QMS the Accounts panel was a modal launched from the
 * chat sidebar; here it is a page in its own console, because this app is meant
 * to grow into the home for cost, users and AI setup as those move across.
 * New sections get a nav item — see CLAUDE.md "Adding a section".
 */
export default function AppShell({
  children,
  active,
  userEmail,
}: {
  children: React.ReactNode;
  active: 'accounts' | 'audit';
  userEmail: string;
}) {
  const router = useRouter();

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand-row">
          <OrcanosLogo />
          <div>
            <p className="app-brand">Orcanos Platform</p>
            <p className="app-brand-sub">Console</p>
          </div>
        </div>

        <nav className="app-nav">
          <Link
            href="/accounts"
            className={`app-nav-item ${active === 'accounts' ? 'app-nav-item--active' : ''}`}
          >
            Accounts
          </Link>
          <Link
            href="/audit"
            className={`app-nav-item ${active === 'audit' ? 'app-nav-item--active' : ''}`}
          >
            Audit log
          </Link>
        </nav>

        <div className="app-sidebar-footer">
          <div className="app-user">{userEmail}</div>
          <button className="app-nav-item" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="app-main">{children}</main>
    </div>
  );
}
