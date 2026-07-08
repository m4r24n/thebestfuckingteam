import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Best Fucking Team",
  description: "A shared daily planner and project workspace for partners.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
