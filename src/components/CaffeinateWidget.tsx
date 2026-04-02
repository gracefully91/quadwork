"use client";

import { useState, useEffect, useCallback } from "react";

const PRESETS = [
  { label: "2 hours", seconds: 7200 },
  { label: "4 hours", seconds: 14400 },
  { label: "8 hours", seconds: 28800 },
  { label: "Until stopped", seconds: 0 },
  { label: "Custom...", seconds: -1 },
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
  const [showCustom, setShowCustom] = useState(false);
  const [customHours, setCustomHours] = useState("1");

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
              key={p.label}
              onClick={() => {
                if (p.seconds === -1) { setShowCustom(true); }
                else start(p.seconds);
              }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-text hover:bg-[#1a1a1a] transition-colors"
            >
              {p.label}
            </button>
          ))}
          {showCustom && (
            <div className="flex items-center gap-1 px-3 py-1.5 border-t border-border">
              <input
                type="number"
                min="1"
                value={customHours}
                onChange={(e) => setCustomHours(e.target.value)}
                className="w-12 bg-transparent border border-border px-1 py-0.5 text-[11px] text-text outline-none focus:border-accent"
              />
              <span className="text-[10px] text-text-muted">hours</span>
              <button
                onClick={() => { const h = parseFloat(customHours); if (h > 0) start(Math.round(h * 3600)); }}
                className="px-2 py-0.5 bg-accent text-bg text-[10px] font-semibold hover:bg-accent-dim transition-colors"
              >
                Start
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
