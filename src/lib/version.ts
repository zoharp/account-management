/**
 * The running app version, read from `package.json` — the single source of
 * truth, kept in step with `release_notes.json` by the release-management
 * convention (bump both, newest note first).
 *
 * Read on the **server** and passed into `AppShell` as a prop rather than
 * imported by the client component directly: importing `package.json` from a
 * `'use client'` file bundles the whole manifest — every dependency and its
 * version — into the browser payload. The version string alone is all the UI
 * needs.
 */
import pkg from '../../package.json';

export const appVersion = (): string => pkg.version;
