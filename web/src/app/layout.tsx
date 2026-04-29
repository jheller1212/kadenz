import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./light-theme.css";
import { ServiceWorkerRegistration } from "./sw-register";
import { ThemeProvider } from "@/components/ThemeProvider";

export const metadata: Metadata = {
  title: "Kadenz",
  description: "Personal running training plan",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Kadenz",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0B",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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
            var t = s.theme || 'light';
            var h = document.documentElement;
            if (t === 'light') {
              h.classList.add('light');
              var v = {"--color-bg":"#F5F5F7","--color-surface":"#FFFFFF","--color-elevated":"#EEEEF0","--color-hairline":"#D8D8DC","--color-text-1":"#1A1A1A","--color-text-2":"#6B6B70","--color-text-3":"#9A9AA0","--color-accent":"#6C3AE0","--color-on-accent":"#FFFFFF","--color-warn":"#E8850A","--color-danger":"#E03A3A"};
              for (var k in v) h.style.setProperty(k, v[k]);
            } else {
              h.classList.remove('light');
            }
          } catch(e) {}
        `}} />
      </head>
      <body className="min-h-full flex flex-col">
        <ThemeProvider />
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
