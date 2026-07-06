import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistration } from "./sw-register";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SessionProvider } from "@/components/SessionProvider";

export const metadata: Metadata = {
  title: "Kadenz",
  description: "Personal running training plan",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Kadenz",
  },
  // Standard replacement for apple-mobile-web-app-capable (Android/standards).
  other: { "mobile-web-app-capable": "yes" },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  // Dynamically updated per active theme by ThemeProvider.
  themeColor: "#0A0A0B",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Required for env(safe-area-inset-*) to resolve on notched iPhones.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased light">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var s = JSON.parse(localStorage.getItem('kadenz_settings') || '{}');
            if ((s.theme || 'light') === 'dark') document.documentElement.classList.remove('light');
          } catch(e) {}
        `}} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider />
        <ServiceWorkerRegistration />
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
