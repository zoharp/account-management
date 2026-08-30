'use client';

import { useEffect } from 'react';
import notes from '../../release_notes.json';

/**
 * What changed, most recent release first.
 *
 * Reads `release_notes.json` at the repo root — the same file the release
 * convention already requires, so there is no second list to keep in step.
 * Bundling it into the client is deliberate: release notes are written to be
 * shown to whoever is signed in, and the file is a few kilobytes.
 *
 * Never put customer data or account names in that file — it ships to the
 * browser verbatim.
 */

interface ReleaseNote {
  version: string;
  date: string;
  changes: string[];
}

/**
 * The change strings carry `**bold**` labels and `` `code` `` spans, per the
 * release-notes format. Rendering those two by hand rather than pulling in a
 * markdown dependency for a modal that shows one list.
 */
function renderInline(text: string, key: number) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={`${key}-${i}`}>{part.slice(1, -1)}</code>;
        }
        return <span key={`${key}-${i}`}>{part}</span>;
      })}
    </>
  );
}

export default function ReleaseNotesModal({ onClose }: { onClose: () => void }) {
  // Escape closes. The other modals here are dismissed by clicking the overlay
  // or the ✕; this one is pure reading, so a keypress is the natural exit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const releases = notes as ReleaseNote[];

  return (
    <div className="acl-overlay" onClick={onClose}>
      <div className="acl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="acl-header">
          <h2>Release notes</h2>
          <button className="acl-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="acl-detail-body">
          {releases.length === 0 ? (
            <p className="acl-empty">No release notes recorded.</p>
          ) : (
            releases.map((rel) => (
              <div key={rel.version} className="rel-entry">
                <div className="rel-entry-head">
                  <span className="rel-version">{rel.version}</span>
                  <span className="rel-date">{rel.date}</span>
                </div>
                <ul className="rel-changes">
                  {rel.changes.map((c, i) => (
                    <li key={i}>{renderInline(c, i)}</li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
