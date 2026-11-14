import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sideout", template: "%s · Sideout" },
  description: "Private OUA women's volleyball fantasy league",
  robots: { index: false, follow: false },
  applicationName: "Sideout",
  appleWebApp: { capable: true, title: "Sideout", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: "#122d63", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
