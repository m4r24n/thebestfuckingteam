"use client";

import { useEffect } from "react";

function setReactInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function WorkspaceBrandEnhancer() {
  useEffect(() => {
    const sync = () => {
      const sourceTitle = document.querySelector<HTMLElement>(".brand-block h1");
      const userSwitcher = document.querySelector<HTMLElement>(".topbar .user-switcher");

      if (sourceTitle && userSwitcher) {
        let wordmark = userSwitcher.querySelector<HTMLElement>(".workspace-wordmark");
        if (!wordmark) {
          wordmark = document.createElement("span");
          wordmark.className = "workspace-wordmark";
          userSwitcher.append(wordmark);
        }
        wordmark.textContent = sourceTitle.textContent?.trim() || "The Best Fucking Team!";
      }

      // Keep the first-time workspace default aligned with the product identity.
      const onboarding = document.querySelector<HTMLElement>(".onboarding-shell");
      if (onboarding) {
        const labels = Array.from(onboarding.querySelectorAll("label"));
        const workspaceLabel = labels.find((label) => label.textContent?.trim().startsWith("Workspace name"));
        const input = workspaceLabel?.querySelector<HTMLInputElement>("input");
        if (input && input.value === "The Best Fucking Team") {
          setReactInputValue(input, "The Best Fucking Team!");
        }
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
