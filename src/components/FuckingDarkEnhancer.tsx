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
  const row = document.createElement("div");
  row.className = "fucking-dark-setting";

  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = "Fucking Dark";
  const note = document.createElement("span");
  note.textContent = "Deeper matte version of the selected accent.";
  copy.append(title, note);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "fucking-dark-toggle";
  button.setAttribute("role", "switch");

  const sync = () => {
    const enabled = readDarkPreference();
    applyDarkPreference(enabled);
    button.classList.toggle("active", enabled);
    button.setAttribute("aria-checked", enabled ? "true" : "false");
    button.setAttribute("aria-label", enabled ? "Turn Fucking Dark off" : "Turn Fucking Dark on");
    button.textContent = enabled ? "ON" : "OFF";
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

  row.append(copy, button);
  sync();
  return row;
}

export default function FuckingDarkEnhancer() {
  useEffect(() => {
    applyDarkPreference(readDarkPreference());

    const mount = () => {
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".settings-card"));
      const appearance = cards.find((card) => card.querySelector(".eyebrow")?.textContent?.trim() === "APPEARANCE");
      if (!appearance || appearance.querySelector(".fucking-dark-setting")) return;

      const note = appearance.querySelector(".settings-note");
      const toggle = makeToggle();
      if (note) appearance.insertBefore(toggle, note);
      else appearance.append(toggle);
    };

    mount();
    const observer = new MutationObserver(mount);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
