"use client";

import { useEffect, useState } from "react";
import ProjectWorkspaceEnhancer from "@/components/ProjectWorkspaceEnhancer";

/**
 * ProjectWorkspace currently keeps the same DOM shell while switching between projects.
 * Remount the enhancer when the visible project identity changes so file/timeline state
 * can never leak from the previously selected project.
 */
export default function ProjectWorkspaceEnhancerHost() {
  const [projectIdentity, setProjectIdentity] = useState("none");

  useEffect(() => {
    const inspect = () => {
      const workspace = document.querySelector<HTMLElement>(".project-workspace");
      const name = workspace?.querySelector<HTMLElement>(".project-identity h3")?.textContent?.trim() ?? "none";
      const target = workspace?.querySelector<HTMLElement>(".project-target")?.textContent?.trim() ?? "";
      const description = workspace?.querySelector<HTMLElement>(".project-identity p")?.textContent?.trim() ?? "";
      const identity = `${name}|${target}|${description}`;
      setProjectIdentity((current) => current === identity ? current : identity);
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return <ProjectWorkspaceEnhancer key={projectIdentity} />;
}
