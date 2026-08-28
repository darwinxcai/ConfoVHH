import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ConfoVHH",
  description:
    "Local-first batch triage for modeled GPCR–nanobody complexes: coordinate interfaces, IMGT CDR mapping, directional PAE, pose recurrence, and auditable research handoff.",
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
