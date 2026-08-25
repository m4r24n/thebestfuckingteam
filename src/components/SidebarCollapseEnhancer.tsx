"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const STORAGE_KEY = "tbft-sidebar-collapsed";

export default function SidebarCollapseEnhancer() {
  const [sidebar, setSidebar] = useState<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const rootState = root.dataset.tbftSidebar;
    let initialCollapsed = rootState === "collapsed";

    if (!rootState) {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        initialCollapsed = saved === null
          ? window.matchMedia("(min-width: 761px) and (max-width: 980px)").matches
          : saved === "1";
      } catch {
        initialCollapsed = window.matchMedia("(min-width: 761px) and (max-width: 980px)").matches;
      }
      root.dataset.tbftSidebar = initialCollapsed ? "collapsed" : "expanded";
    }

    setCollapsed(initialCollapsed);

    const inspect = () => {
      const nextSidebar = document.querySelector<HTMLElement>(".sidebar");
      if (!nextSidebar) return;
      setSidebar((current) => current === nextSidebar ? current : nextSidebar);

      nextSidebar.querySelectorAll<HTMLButtonElement>(".main-nav .nav-item").forEach((button) => {
        const icon = button.querySelector("span")?.textContent ?? "";
        const label = (button.textContent ?? "").replace(icon, "").trim();
        if (!label) return;
        button.dataset.tbftNavLabel = label;
        button.title = label;
        button.setAttribute("aria-label", label);
      });
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      document.documentElement.dataset.tbftSidebar = next ? "collapsed" : "expanded";
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // The sidebar still works for this session if storage is unavailable.
      }
      return next;
    });
  };

  if (!sidebar) return null;

  return createPortal(
    <button
      type="button"
      className="tbft-sidebar-toggle"
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-pressed={collapsed}
    >
      <span aria-hidden="true">{collapsed ? "›" : "‹"}</span>
    </button>,
    sidebar,
  );
}
