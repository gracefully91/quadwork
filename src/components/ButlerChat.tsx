"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useLocale } from "@/components/LocaleProvider";

const COPY = {
  en: {
    butlerAgent: "Butler Agent",
    collapse: "collapse",
    expand: "expand",
    inputPlaceholder: "Message butler...",
    send: "Send",
    startButler: "Start Butler",
    starting: "Starting...",
    butlerDisabled: "Butler is not enabled.",
    enableInSettings: "Enable in Settings →",
  },
  ko: {
    butlerAgent: "버틀러 에이전트",
    collapse: "접기",
    expand: "펼치기",
    inputPlaceholder: "버틀러에게 메시지...",
    send: "전송",
    startButler: "버틀러 시작",
    starting: "시작 중...",
    butlerDisabled: "버틀러가 활성화되지 않았습니다.",
    enableInSettings: "설정에서 활성화 →",
  },
} as const;

interface ButlerStatus {
  enabled: boolean;
  running: boolean;
}

export default function ButlerChat() {
  const { locale } = useLocale();
  const t = COPY[locale];

  const [status, setStatus] = useState<ButlerStatus>({ enabled: false, running: false });
  const [collapsed, setCollapsed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [input, setInput] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch butler config + status on mount
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/config").then((r) => r.ok ? r.json() : null),
      fetch("/api/butler/status").then((r) => r.ok ? r.json() : null),
    ]).then(([cfg, st]) => {
      if (cancelled) return;
      const enabled = !!(cfg?.butler?.enabled);
      const running = !!(st?.running);
      setStatus({ enabled, running });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const fit = useCallback(() => {
    if (fitRef.current && termRef.current && containerRef.current) {
      try {
        fitRef.current.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "resize",
            cols: termRef.current.cols,
            rows: termRef.current.rows,
          }));
        }
      } catch {}
    }
  }, []);

  // Connect xterm + WebSocket when running and not collapsed
  useEffect(() => {
    if (!status.running || collapsed || !containerRef.current) return;

    const term = new Terminal({
      scrollback: 1000,
      fontSize: 11,
      fontFamily: '"Geist Mono", "JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      lineHeight: 1.2,
      letterSpacing: 0.5,
      cursorBlink: false,
      cursorStyle: "block",
      disableStdin: true,
      theme: {
        background: "#0a0a0a",
        foreground: "#e0e0e0",
        cursor: "#00ff88",
        cursorAccent: "#0a0a0a",
        selectionBackground: "#00ff8844",
        black: "#0a0a0a",
        red: "#ff4444",
        green: "#00ff88",
        yellow: "#ffcc00",
        blue: "#4488ff",
        magenta: "#cc44ff",
        cyan: "#44ccff",
        white: "#e0e0e0",
        brightBlack: "#737373",
        brightRed: "#ff6666",
        brightGreen: "#00ff88",
        brightYellow: "#ffdd44",
        brightBlue: "#66aaff",
        brightMagenta: "#dd66ff",
        brightCyan: "#66ddff",
        brightWhite: "#ffffff",
      },
      allowTransparency: false,
      drawBoldTextInBrightColors: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fitAddon;

    requestAnimationFrame(() => fit());

    const observer = new ResizeObserver(() => fit());
    observer.observe(containerRef.current);

    // Connect to /ws/butler
    let cancelled = false;
    let baseUrl: string | null = null;

    const resolveBase = async (): Promise<string> => {
      if (baseUrl) return baseUrl;
      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      try {
        const res = await fetch("/api/config");
        if (res.ok) {
          const cfg = await res.json();
          const backendPort = cfg.port || 8400;
          const currentPort = parseInt(window.location.port, 10);
          if (currentPort && currentPort !== backendPort) {
            baseUrl = `${wsProto}//${window.location.hostname}:${backendPort}`;
          } else {
            baseUrl = `${wsProto}//${window.location.host}`;
          }
        } else {
          baseUrl = `${wsProto}//${window.location.host}`;
        }
      } catch {
        baseUrl = `${wsProto}//${window.location.host}`;
      }
      return baseUrl;
    };

    const connect = async () => {
      const base = await resolveBase();
      if (cancelled) return;

      const ws = new WebSocket(`${base}/ws/butler`);
      wsRef.current = ws;

      let postReplayFitTimer: ReturnType<typeof setInterval> | null = null;

      ws.onopen = () => {
        if (postReplayFitTimer) clearInterval(postReplayFitTimer);
        let fitAttempts = 0;
        postReplayFitTimer = setInterval(() => {
          fit();
          fitAttempts++;
          if (fitAttempts >= 4) {
            clearInterval(postReplayFitTimer!);
            postReplayFitTimer = null;
          }
        }, 500);
        ws.send(JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }));
        ws.send(JSON.stringify({ type: "replay" }));
      };

      ws.onmessage = (e) => {
        term.write(e.data);
      };

      ws.onclose = (e) => {
        if (postReplayFitTimer) {
          clearInterval(postReplayFitTimer);
          postReplayFitTimer = null;
        }
        if (cancelled) return;
        term.write(`\r\n\x1b[38;2;115;115;115m[session closed: ${e.reason || e.code}]\x1b[0m\r\n`);
        setStatus((prev) => ({ ...prev, running: false }));
      };
    };

    connect();

    return () => {
      cancelled = true;
      observer.disconnect();
      wsRef.current?.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [status.running, collapsed, fit]);

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await fetch("/api/butler/start", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setStatus({ enabled: true, running: true });
      }
    } catch {}
    setStarting(false);
  };

  const sendInput = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(trimmed + "\r");
      setInput("");
    }
  };

  // Not enabled — don't render
  if (!status.enabled) return null;

  // Collapsed state
  if (collapsed) {
    return (
      <div className="mb-6 border border-border bg-bg-surface">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="w-full flex items-center justify-between px-4 py-2 text-[11px] text-text-muted hover:text-text transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${status.running ? "bg-accent" : "bg-text-muted"}`} />
            <span className="font-semibold text-text">{t.butlerAgent}</span>
          </span>
          <span>▸ {t.expand}</span>
        </button>
      </div>
    );
  }

  // Enabled but not running — show start button
  if (!status.running) {
    return (
      <div className="mb-6 border border-border bg-bg-surface">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border">
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-text-muted" />
            <span className="text-[11px] font-semibold text-text">{t.butlerAgent}</span>
          </span>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-[10px] text-text-muted hover:text-text transition-colors"
          >
            ▾ {t.collapse}
          </button>
        </div>
        <div className="flex flex-col items-center justify-center py-8">
          <button
            type="button"
            onClick={handleStart}
            disabled={starting}
            className="px-4 py-2 text-[12px] font-semibold text-bg bg-accent hover:bg-accent-dim transition-colors disabled:opacity-50"
          >
            {starting ? t.starting : t.startButler}
          </button>
        </div>
      </div>
    );
  }

  // Running — show terminal + input
  return (
    <div className="mb-6 border border-border bg-bg-surface flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <span className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          <span className="text-[11px] font-semibold text-text">{t.butlerAgent}</span>
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="text-[10px] text-text-muted hover:text-text transition-colors"
        >
          ▾ {t.collapse}
        </button>
      </div>

      {/* Terminal */}
      <div ref={containerRef} className="h-[40vh] min-h-[200px]" />

      {/* Input bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              sendInput();
            }
          }}
          placeholder={t.inputPlaceholder}
          className="flex-1 bg-transparent text-[11px] text-text placeholder:text-text-muted outline-none border border-border px-2 py-1.5"
        />
        <button
          type="button"
          onClick={sendInput}
          className="text-[11px] text-text-muted hover:text-text px-2 py-1.5 border border-border hover:border-text-muted transition-colors"
        >
          {t.send}
        </button>
      </div>
    </div>
  );
}
