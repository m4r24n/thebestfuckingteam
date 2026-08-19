import type { Metadata } from "next";
import "./globals.css";
import "./dashboard-v2.css";
import "./recurring-tasks.css";
import "./archive-permanent-delete.css";
import "./project-workspace-v2.css";
import "./google-drive.css";

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
