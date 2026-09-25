/**
 * GET /api/handbook — the Orcanos AI infrastructure handbook deck, as HTML.
 *
 * The deck (`docs/platform/orcanos-ai-infrastructure.html`) is one
 * self-contained file with its own inline CSS and script. It describes secrets,
 * tenants, hosts and open security risks, so it is served from behind the staff
 * gate like every other route — NOT from `public/`, which this app does not have
 * and which would bypass the gate (there is no middleware).
 *
 * Framed by `/handbook`. The site-wide `frame-ancestors 'none'` would block even
 * a same-origin frame, so `next.config.mjs` relaxes it to `'self'` for this one
 * path. The deck carries no controls that act on data, so being framable by this
 * origin adds no clickjacking surface.
 *
 * The file is read at request time; `outputFileTracingIncludes` in
 * `next.config.mjs` is what ships it into the Vercel function.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { requirePlatformStaff } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DECK_PATH = path.join(process.cwd(), 'docs', 'platform', 'orcanos-ai-infrastructure.html');

export async function GET() {
  const { error } = await requirePlatformStaff();
  if (error) return error;

  let html: string;
  try {
    html = await readFile(DECK_PATH, 'utf8');
  } catch (e) {
    console.error('[handbook] deck file not readable', e);
    return Response.json({ detail: 'Handbook not available in this build' }, { status: 500 });
  }

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Staff-only content: never let a shared cache keep a copy.
      'Cache-Control': 'private, no-store',
    },
  });
}
