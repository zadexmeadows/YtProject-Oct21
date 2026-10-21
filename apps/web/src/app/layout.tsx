import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'YouTube Live Chat Intelligence',
  description: 'Admin dashboard for public YouTube live chat capture and analysis',
};

const androidAppBootstrap = `
  (() => {
    if (!navigator.userAgent.includes('YTMonitorAndroidApp/')) return;
    document.documentElement.classList.add('android-app');
    document.documentElement.dataset.appPlatform = 'android';
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      viewport.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
    }
  })();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          id="android-app-bootstrap"
          dangerouslySetInnerHTML={{ __html: androidAppBootstrap }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
