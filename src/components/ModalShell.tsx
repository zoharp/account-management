'use client';

import type { ReactNode } from 'react';

/**
 * The chrome every account dialog shares — overlay, panel, title bar, close.
 *
 * ## Why it exists: `embedded`
 *
 * `AccountManageModal` shows the SAME components as tabs inside one window, so
 * that an operator has one screen per account instead of a row of buttons that
 * each open something different. Rather than fork those components — which would
 * mean two copies of their save logic drifting apart — each one renders its body
 * through this shell and the shell decides whether to draw a window around it.
 *
 * `embedded` therefore means: **you are already inside somebody else's window.**
 * Draw no overlay, no panel, no title bar and no close button, because there is
 * exactly one of each on screen and it is not yours. Get this wrong and you get
 * a dialog inside a dialog with two close buttons, one of which closes the wrong
 * thing.
 *
 * The body class stays `acl-detail-body` in both modes so the existing styling
 * applies unchanged — the stylesheets here are global (there are no CSS modules),
 * so this is the one class that must not become conditional.
 */
export default function ModalShell({
  embedded = false,
  title,
  subtitle,
  onClose,
  className = '',
  children,
}: {
  embedded?: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  if (embedded) return <>{children}</>;

  return (
    <div className="acl-overlay" onClick={onClose}>
      <div className={`acl-modal ${className}`.trim()} onClick={(e) => e.stopPropagation()}>
        <div className="acl-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <span className="acl-header-sub">{subtitle}</span> : null}
          </div>
          <button className="acl-close" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
