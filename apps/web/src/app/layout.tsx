import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';

import './globals.css';

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-archivo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Nightfall — a social deduction game',
  description:
    'Five nights. One liar. Create a room, send the link, and play Mafia in the browser. Roles are dealt in secret by the server — nobody can peek, not even the host.',
};

export const viewport: Viewport = {
  themeColor: '#0e0d0d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
