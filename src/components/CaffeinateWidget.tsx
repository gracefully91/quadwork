"use client";

import { useState, useEffect, useCallback } from "react";

const PRESETS = [
  { label: "2 hours", seconds: 7200 },
  { label: "4 hours", seconds: 14400 },
  { label: "8 hours", seconds: 28800 },
  { label: "Until stopped", seconds: 0 },
];

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function CaffeinateWidget() {
  const [active, setActive] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [platform, setPlatform] = useState<string>("");
  const [showPresets, setShowPresets] = useState(false);

  const poll = useCallback(() => {
    fetch("/api/caffeinate/status")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return;
        setActive(data.active);
        setRemaining(data.remaining);
        setPlatform(data.platform);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [poll]);

  const start = (seconds: number) => {
    fetch("/api/caffeinate/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration: seconds }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setActive(true);
          setRemaining(seconds || null);
        }
      })
      .catch(() => {});
    setShowPresets(false);
  };

  const stop = () => {
    fetch("/api/caffeinate/stop", { method: "POST" })
      .then(() => {
        setActive(false);
        setRemaining(null);
      })
      .catch(() => {});
  };

  // Hide on non-macOS
  if (platform && platform !== "darwin") return null;

  return (
    <div className="relative">
      <button
        onClick={() => active ? stop() : setShowPresets(!showPresets)}
        className={`flex items-center gap-1.5 px-2 py-1 text-[11px] border transition-colors ${
          active
            ? "border-accent/50 text-accent bg-accent/10 hover:bg-accent/20"
            : "border-border text-text-muted hover:text-text hover:border-accent"
        }`}
      >
        <span>{active ? "Awake" : "Keep awake"}</span>
        {active && remaining !== null && remaining > 0 && (
          <span className="text-[10px] text-accent/70">{formatTime(remaining)}</span>
        )}
        {active && remaining === null && (
          <span className="text-[10px] text-accent/70">on</span>
        )}
      </button>

      {showPresets && !active && (
        <div className="absolute top-full right-0 mt-1 border border-border bg-bg-surface z-20 min-w-[160px]">
          <p className="px-3 py-1.5 text-[10px] text-[#ffcc00] border-b border-border">
            Make sure your Mac is plugged in
          </p>
          {PRESETS.map((p) => (
            <button
              key={p.seconds}
              onClick={() => start(p.seconds)}
              className="w-full text-left px-3 py-1.5 text-[11px] text-text hover:bg-[#1a1a1a] transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
