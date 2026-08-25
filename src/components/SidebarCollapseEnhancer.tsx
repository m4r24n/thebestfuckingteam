"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const STORAGE_KEY = "tbft-sidebar-collapsed";

export default function SidebarCollapseEnhancer() {
  const [navTarget, setNavTarget] = useState<HTMLElement | null>(null);
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
      const nav = document.querySelector<HTMLElement>(".sidebar .main-nav");
      if (!nav) return;
      setNavTarget((current) => current === nav ? current : nav);

      nav.querySelectorAll<HTMLButtonElement>(".nav-item").forEach((button) => {
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

  if (!navTarget) return null;

  const label = collapsed ? "Expand" : "Collapse";

  return createPortal(
    <button
      type="button"
      className="nav-item tbft-sidebar-toggle"
      onClick={toggle}
      aria-label={`${label} sidebar`}
      title={`${label} sidebar`}
      data-tbft-nav-label={`${label} sidebar`}
      aria-pressed={collapsed}
    >
      <span aria-hidden="true">{collapsed ? "»" : "«"}</span>
      {label}
    </button>,
    navTarget,
  );
}
