import type { Metadata } from 'next';
import { SessionProvider } from '../lib/session';
import './tokens.css';
import './globals.css';

export const metadata: Metadata = { title: 'Quillquest' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the person's theme choice before first paint so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('qq.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}" }} />
      </head>
      <body><SessionProvider>{children}</SessionProvider></body>
    </html>
  );
}
