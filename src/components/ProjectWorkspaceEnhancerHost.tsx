"use client";

import { useEffect, useState } from "react";
import ProjectWorkspaceEnhancer from "@/components/ProjectWorkspaceEnhancer";

/** Remount file/activity state whenever the selected project changes. */
export default function ProjectWorkspaceEnhancerHost() {
  const [projectIdentity, setProjectIdentity] = useState("none");

  useEffect(() => {
    const inspect = () => {
      const workspace = document.querySelector<HTMLElement>(".project-workspace-redesign");
      const identity = workspace?.dataset.projectId ?? "none";
      setProjectIdentity((current) => current === identity ? current : identity);
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return <ProjectWorkspaceEnhancer key={projectIdentity} />;
}
