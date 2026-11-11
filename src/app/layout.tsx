import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Praetor",
  description: "A local GitHub issue-to-pull-request workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
