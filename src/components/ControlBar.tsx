"use client";

import { useState, useEffect, useCallback } from "react";

// ─── Server Controls ─────────────────────────────────────────────────────────

function ServerSection({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  const clearFeedback = () => {
    setTimeout(() => setFeedback(null), 3000);
  };

  // Auto-reset confirmation after 4s if user doesn't follow through
  useEffect(() => {
    if (!confirmStop) return;
    const timer = setTimeout(() => setConfirmStop(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmStop]);

  const handleStop = async () => {
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    setConfirmStop(false);
    setLoading("stop");
    try {
      const r = await fetch(
        `/api/agentchattr/${encodeURIComponent(projectId)}/stop`,
        { method: "POST" }
      );
      const d = await r.json();
      setFeedback(d.ok ? "Stopped" : "Failed");
    } catch {
      setFeedback("Error");
    }
    setLoading(null);
    clearFeedback();
  };

  const handleRestart = async () => {
    setLoading("restart");
    try {
      const r = await fetch(
        `/api/agentchattr/${encodeURIComponent(projectId)}/restart`,
        { method: "POST" }
      );
      const d = await r.json();
      if (d.ok && d.pid) {
        setFeedback(`Restarted (PID: ${d.pid})`);
      } else {
        setFeedback(d.error || "Failed to restart");
      }
    } catch {
      setFeedback("Error");
    }
    setLoading(null);
    clearFeedback();
  };

  const handleReset = async () => {
    setLoading("reset");
    try {
      const r = await fetch(
        `/api/agents/${encodeURIComponent(projectId)}/reset`,
        { method: "POST" }
      );
      const d = await r.json();
      setFeedback(
        d.ok ? `Reset — ${d.cleared} of ${d.total} slot${d.total !== 1 ? "s" : ""} deregistered` : "Failed"
      );
    } catch {
      setFeedback("Error");
    }
    setLoading(null);
    clearFeedback();
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
        Server
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={handleStop}
          disabled={!!loading}
          className={`px-1.5 py-0.5 text-[10px] border transition-colors disabled:opacity-50 ${
            confirmStop
              ? "text-error border-error/60 bg-error/10 hover:bg-error/20"
              : "text-text-muted border-border hover:text-error hover:border-error/40"
          }`}
        >
          {loading === "stop" ? "..." : confirmStop ? "Confirm Stop?" : "Stop"}
        </button>
        <button
          onClick={handleRestart}
          disabled={!!loading}
          className="px-1.5 py-0.5 text-[10px] text-text-muted border border-border hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-50"
        >
          {loading === "restart" ? "..." : "Restart"}
        </button>
        <button
          onClick={handleReset}
          disabled={!!loading}
          className="px-1.5 py-0.5 text-[10px] text-text-muted border border-border hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-50"
        >
          {loading === "reset" ? "..." : "Reset Agents"}
        </button>
      </div>
      {feedback && (
        <div className="text-[10px] text-accent">{feedback}</div>
      )}
    </div>
  );
}

// ─── System (Caffeinate) ─────────────────────────────────────────────────────

// #407 / quadwork#270: free-typed hours input replaces the fixed
// preset list. Same default/min/max/step pattern as the Scheduled
// Trigger custom-hours fix in #406. The "Until stopped" option is
// preserved here (issue requires it) as a separate checkbox.
const KEEP_AWAKE_HOURS_DEFAULT = 3;
const KEEP_AWAKE_HOURS_MIN = 0.1;
const KEEP_AWAKE_HOURS_MAX = 24;
function clampKeepAwakeHours(h: number): number {
  if (!Number.isFinite(h)) return KEEP_AWAKE_HOURS_DEFAULT;
  return Math.min(Math.max(h, KEEP_AWAKE_HOURS_MIN), KEEP_AWAKE_HOURS_MAX);
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function SystemSection() {
  const [active, setActive] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [platform, setPlatform] = useState<string>("");
  const [showPresets, setShowPresets] = useState(false);
  // #407 / quadwork#270: free-typed hours draft + "Until stopped"
  // override. Same draft-string pattern as #406 so decimals stay
  // typeable.
  const [hoursDraft, setHoursDraft] = useState<string>(String(KEEP_AWAKE_HOURS_DEFAULT));
  const [untilStopped, setUntilStopped] = useState<boolean>(false);
  const [showHelp, setShowHelp] = useState(false);

  const poll = useCallback(() => {
    fetch("/api/caffeinate/status")
      .then((r) => (r.ok ? r.json() : null))
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

  if (platform && platform !== "darwin") return null;

  return (
    <div className="flex flex-col gap-1 relative">
      <div className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
        System
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => (active ? stop() : setShowPresets(!showPresets))}
          className={`px-1.5 py-0.5 text-[10px] border transition-colors ${
            active
              ? "border-accent/50 text-accent bg-accent/10 hover:bg-accent/20"
              : "border-border text-text-muted hover:text-text hover:border-accent"
          }`}
        >
          {active ? "Awake" : "Keep Awake"}
          {active && remaining !== null && remaining > 0 && (
            <span className="ml-1 text-accent/70">{formatTime(remaining)}</span>
          )}
          {active && remaining === null && (
            <span className="ml-1 text-accent/70">on</span>
          )}
        </button>
      </div>

      {showPresets && !active && (
        <div className="absolute bottom-full left-0 mb-1 p-2 border border-border bg-bg-surface z-20 min-w-[220px] flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-muted uppercase tracking-wider">Keep Awake</span>
            <button
              type="button"
              aria-label="About Keep Awake"
              onClick={() => setShowHelp((s) => !s)}
              className="w-3.5 h-3.5 rounded-full border border-border text-[9px] leading-none text-text-muted hover:text-accent hover:border-accent inline-flex items-center justify-center"
            >?</button>
          </div>
          {showHelp && (
            <div className="p-1.5 text-[10px] leading-snug text-text bg-bg border border-border/60 rounded">
              <b>Keep Awake</b> prevents your Mac from sleeping for the duration you set. Use this when you want agents to keep working overnight.
              <br /><br />
              Under the hood, this runs macOS&apos;s <code>caffeinate</code> command. While it&apos;s active your screen, disk, and system idle timers are all paused — make sure your Mac is <b>plugged in</b> to avoid draining the battery.
            </div>
          )}
          <p className="text-[10px] text-[#ffcc00]">
            Make sure Mac is plugged in
          </p>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-text-muted">for</span>
            <input
              type="number"
              value={hoursDraft}
              onChange={(e) => setHoursDraft(e.target.value)}
              onBlur={() => {
                const raw = parseFloat(hoursDraft);
                const hours = Number.isFinite(raw) ? clampKeepAwakeHours(raw) : KEEP_AWAKE_HOURS_DEFAULT;
                setHoursDraft(String(Math.round(hours * 10) / 10));
              }}
              disabled={untilStopped}
              min={KEEP_AWAKE_HOURS_MIN}
              max={KEEP_AWAKE_HOURS_MAX}
              step={0.1}
              className="w-14 bg-transparent border border-border px-1 py-0.5 text-text outline-none focus:border-accent text-center disabled:opacity-40"
            />
            <span className="text-text-muted">hours</span>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={untilStopped}
              onChange={(e) => setUntilStopped(e.target.checked)}
            />
            Until stopped (no expiry)
          </label>
          <button
            type="button"
            onClick={() => {
              if (untilStopped) {
                start(0);
                return;
              }
              const raw = parseFloat(hoursDraft);
              const hours = Number.isFinite(raw) ? clampKeepAwakeHours(raw) : KEEP_AWAKE_HOURS_DEFAULT;
              start(Math.round(hours * 3600));
            }}
            className="self-start px-2 py-0.5 text-[10px] text-accent border border-accent/40 rounded hover:bg-accent/10 transition-colors"
          >
            Start
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main ControlBar ─────────────────────────────────────────────────────────

interface ControlBarProps {
  projectId: string;
}

export default function ControlBar({ projectId }: ControlBarProps) {
  // #210: Keep Alive moved to the Scheduled Trigger widget in the
  // bottom-right Operator Features quadrant. ControlBar now only
  // carries the server lifecycle + system controls.
  return (
    <div className="border-t border-border px-3 py-2">
      <div className="flex items-start gap-6">
        <ServerSection projectId={projectId} />
        <div className="w-px self-stretch bg-border" />
        <SystemSection />
      </div>
    </div>
  );
}
