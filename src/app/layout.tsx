import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Orcanos Platform Console',
  description: 'Account management for the Orcanos platform',
};

// Explicit viewport is what makes the CSS breakpoints below fire on phones —
// without it Mobile Safari renders at a 980px viewport and the whole responsive
// layout is bypassed. `maximum-scale` is deliberately unset so users can still
// zoom.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
