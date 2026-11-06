import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sideout", template: "%s · Sideout" },
  description: "Private OUA women's volleyball fantasy league",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0b1020", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
