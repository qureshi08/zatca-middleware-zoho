import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import { AppProvider } from '@/context/AppContext';
import { getOnboardingStatus } from '@/lib/zatca/onboarding-storage';

export const metadata: Metadata = {
  title: 'Z3C Compliance Platform | Bank of Jordan – ZATCA Phase 2',
  description: 'Bank of Jordan ZATCA Phase 2 E-Invoicing Integration & Compliance Platform',
  icons: { icon: '/favicon.ico' },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // In a multi-tenant system, environment mode is specific to each organization
  // and is displayed inside the specific pages rather than globally.
  const mode = 'unconfigured';

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body suppressHydrationWarning>
        <AppProvider>
          <div className="app-shell">
            <Sidebar mode={mode} />
            <div className="main-content">
              {children}
            </div>
          </div>
        </AppProvider>
      </body>
    </html>
  );
}

