"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type BackgroundPreset = "paper" | "aqua" | "sage" | "clean";

const STORAGE_KEY = "tbft-background-preset-v1";

const PRESETS: Array<{
  id: BackgroundPreset;
  label: string;
  description: string;
}> = [
  { id: "paper", label: "Paper", description: "The current warm notebook background." },
  { id: "aqua", label: "Aqua", description: "Washed turquoise and mint, inspired by your reference." },
  { id: "sage", label: "Sage Mist", description: "Soft green-grey with a quiet, natural feel." },
  { id: "clean", label: "Clean", description: "A bright neutral canvas with minimal texture." },
];

function isPreset(value: string | null): value is BackgroundPreset {
  return PRESETS.some((preset) => preset.id === value);
}

function applyPreset(preset: BackgroundPreset) {
  document.documentElement.dataset.tbftBackground = preset;
}

export default function BackgroundSettings() {
  const [preset, setPreset] = useState<BackgroundPreset>("paper");
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial = isPreset(stored) ? stored : "paper";
    setPreset(initial);
    applyPreset(initial);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyPreset(preset);
    window.localStorage.setItem(STORAGE_KEY, preset);
  }, [preset, ready]);

  useEffect(() => {
    let currentHost: HTMLElement | null = null;

    const inspect = () => {
      const appearanceCard = Array.from(document.querySelectorAll<HTMLElement>(".settings-card"))
        .find((card) => card.querySelector<HTMLElement>(".eyebrow")?.textContent?.trim() === "APPEARANCE");

      if (!appearanceCard) {
        setMount(null);
        currentHost = null;
        return;
      }

      let host = appearanceCard.querySelector<HTMLElement>(".tbft-background-settings-mount");
      if (!host) {
        host = document.createElement("div");
        host.className = "tbft-background-settings-mount";
        appearanceCard.appendChild(host);
      }

      if (host !== currentHost) {
        currentHost = host;
        setMount(host);
      }
    };

    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      currentHost?.remove();
    };
  }, []);

  if (!mount) return null;

  return createPortal(
    <div className="background-setting-block">
      <span className="background-setting-label">App background</span>
      <div className="background-preset-selector" role="group" aria-label="App background">
        {PRESETS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={preset === option.id ? "active" : ""}
            data-background-preview={option.id}
            aria-pressed={preset === option.id}
            onClick={() => setPreset(option.id)}
          >
            <span className="background-preset-preview" aria-hidden="true" />
            <span className="background-preset-copy">
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </button>
        ))}
      </div>
      <small className="background-setting-hint">Saved only on this browser/device, so each person can choose their own.</small>
    </div>,
    mount,
  );
}
