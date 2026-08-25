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
import "./workspace-brand.css";
import "./task-files.css";
import "./task-detail.css";
import "./today-accent.css";
import "./sidebar-collapse.css";

export const metadata: Metadata = {
  title: "The Best Fucking Team",
  description: "A shared daily planner and project workspace for partners.",
};

const darkBootScript = `try{document.documentElement.dataset.tbftDark=localStorage.getItem('tbft-fucking-dark')==='1'?'true':'false'}catch(e){document.documentElement.dataset.tbftDark='false'}`;
const sidebarBootScript = `try{const saved=localStorage.getItem('tbft-sidebar-collapsed');document.documentElement.dataset.tbftSidebar=saved===null?(matchMedia('(min-width:761px) and (max-width:980px)').matches?'collapsed':'expanded'):(saved==='1'?'collapsed':'expanded')}catch(e){document.documentElement.dataset.tbftSidebar=matchMedia('(min-width:761px) and (max-width:980px)').matches?'collapsed':'expanded'}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: darkBootScript }} />
        <script dangerouslySetInnerHTML={{ __html: sidebarBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
