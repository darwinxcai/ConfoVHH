import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ConfoVHH | GPCR–VHH Structural Interface Review",
  description:
    "Review GPCR–VHH structural interfaces locally using coordinate geometry, IMGT CDR mapping, directional PAE, pose recurrence, explicit provenance, and conservative interpretation.",
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
