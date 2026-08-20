"use client";

import { useEffect } from "react";

const STORAGE_KEY = "tbft-fucking-dark";

function readDarkPreference() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function applyDarkPreference(enabled: boolean) {
  document.documentElement.dataset.tbftDark = enabled ? "true" : "false";
}

function makeToggle() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fucking-dark-toggle";
  button.textContent = "Fucking Dark";

  const sync = () => {
    const enabled = readDarkPreference();
    applyDarkPreference(enabled);
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-pressed", enabled ? "true" : "false");
  };

  button.addEventListener("click", () => {
    const next = !readDarkPreference();
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Still apply for the current page if storage is unavailable.
    }
    applyDarkPreference(next);
    sync();
  });

  sync();
  return button;
}

export default function FuckingDarkEnhancer() {
  useEffect(() => {
    applyDarkPreference(readDarkPreference());

    const mount = () => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".settings-card"));
      const appearance = cards.find((card) => card.querySelector(".eyebrow")?.textContent?.trim() === "APPEARANCE");
      if (!appearance || appearance.querySelector(".fucking-dark-toggle")) return;

      const accentSelector = appearance.querySelector(".accent-selector");
      if (!accentSelector) return;

      const button = makeToggle();
      accentSelector.insertAdjacentElement("afterend", button);
    };

    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
