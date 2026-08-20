import type { Metadata } from "next";
import "./globals.css";
import "./dashboard-v2.css";
import "./mobile-readability.css";
import "./recurring-tasks.css";
import "./archive-permanent-delete.css";
import "./project-workspace-v2.css";
import "./google-drive.css";
import "./typography-v2.css";
import "./final-polish.css";
import "./fucking-dark.css";
import "./settings-compact.css";

export const metadata: Metadata = {
  title: "The Best Fucking Team",
  description: "A shared daily planner and project workspace for partners.",
};

const darkBootScript = `try{document.documentElement.dataset.tbftDark=localStorage.getItem('tbft-fucking-dark')==='1'?'true':'false'}catch(e){document.documentElement.dataset.tbftDark='false'}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: darkBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
