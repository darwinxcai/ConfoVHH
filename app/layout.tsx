import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ConfoVHH",
  description:
    "Local-first coordinate review for modeled GPCR–nanobody complexes: interface geometry, IMGT CDR mapping, directional PAE, pose recurrence, and auditable research handoff.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
