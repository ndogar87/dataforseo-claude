import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "DataForSEO Studio",
  description: "Staff dashboard for the DataForSEO-powered SEO platform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="min-h-screen bg-background font-sans antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
