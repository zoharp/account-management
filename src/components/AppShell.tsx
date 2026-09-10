'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import OrcanosLogo from './OrcanosLogo';
import ReleaseNotesModal from './ReleaseNotesModal';

/**
 * The standing chrome. In QMS the Accounts panel was a modal launched from the
 * chat sidebar; here it is a page in its own console, because this app is meant
 * to grow into the home for cost, users and AI setup as those move across.
 * New sections get a nav item — see CLAUDE.md "Adding a section".
 *
 * On narrow viewports the sidebar becomes an off-canvas drawer, opened by the
 * hamburger in the top bar. The drawer is CSS-driven — the same markup, styled
 * differently under `@media (max-width: 860px)` — so nothing about the desktop
 * layout changes.
 */
export default function AppShell({
  children,
  active,
  userEmail,
  version,
}: {
  children: React.ReactNode;
  active: 'accounts' | 'audit';
  userEmail: string;
  /** From `appVersion()`, read server-side — see `lib/version.ts`. */
  version: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [showNotes, setShowNotes] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // A nav click on mobile navigates, but React doesn't unmount the shell —
  // close the drawer manually when the URL changes so the user actually sees
  // the page they picked.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // Body scroll lock while the drawer covers the screen. Without it, dragging
  // on the drawer scrolls the page underneath.
  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className={`app-shell ${navOpen ? 'app-shell--nav-open' : ''}`}>
      {/* Top bar only appears on mobile (display:none on desktop). Carries the
          hamburger and a compact brand so the user still knows where they are
          with the sidebar hidden. */}
      <header className="app-topbar">
        <button
          className="app-hamburger"
          onClick={() => setNavOpen((v) => !v)}
          aria-label={navOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={navOpen}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="app-topbar-brand">
          <OrcanosLogo />
          <span>Orcanos Platform</span>
        </div>
      </header>

      {/* Tap-outside scrim to dismiss the drawer. Only shown while open. */}
      {navOpen && (
        <button
          type="button"
          className="app-scrim"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />
      )}

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
          {/* Which build is actually in front of you — the first question in
              any "is my change live?" conversation. Clicking it says what
              changed. */}
          <button
            className="app-version"
            onClick={() => setShowNotes(true)}
            title="What's new in this release"
          >
            v{version}
          </button>
        </div>
      </aside>

      <main className="app-main">{children}</main>

      {showNotes && <ReleaseNotesModal onClose={() => setShowNotes(false)} />}
    </div>
  );
}
