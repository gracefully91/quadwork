"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Project {
  id: string;
  name: string;
  repo: string;
  agentCount: number;
  openPrs: number;
}

interface Activity {
  id: number;
  time: string;
  project: string;
  text: string;
}

export default function HomeDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setProjects(data);
      })
      .catch(() => {});

    // Activity feed from chat proxy (recent messages as activity)
    fetch("/api/chat?path=/api/messages&channel=general&limit=10")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => {
        const msgs = Array.isArray(data) ? data : data.messages || [];
        setActivity(
          msgs.slice(-10).reverse().map((m: { id: number; time: string; sender: string; text: string }) => ({
            id: m.id,
            time: m.time?.slice(0, 5) || "",
            project: m.sender,
            text: m.text.length > 120 ? m.text.slice(0, 120) + "…" : m.text,
          }))
        );
      })
      .catch(() => {});
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-text tracking-tight">Projects</h1>
        <p className="text-xs text-text-muted mt-1">
          {projects.length} configured project{projects.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Project cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-8">
        {projects.map((project) => (
          <Link
            key={project.id}
            href={`/project/${project.id}`}
            className="block border border-border bg-bg-surface p-4 hover:bg-[#1a1a1a] transition-colors group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                <span className="text-sm font-semibold text-text">{project.name}</span>
              </div>
              <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                open →
              </span>
            </div>

            <div className="flex gap-4 text-[11px]">
              <div>
                <span className="text-text-muted">agents</span>
                <span className="ml-1.5 text-text">{project.agentCount}</span>
              </div>
              <div>
                <span className="text-text-muted">PRs</span>
                <span className="ml-1.5 text-text">{project.openPrs}</span>
              </div>
              <div>
                <span className="text-text-muted">repo</span>
                <span className="ml-1.5 text-text">{project.repo}</span>
              </div>
            </div>
          </Link>
        ))}

        {/* + New Project placeholder */}
        <button className="border border-dashed border-border p-4 flex items-center justify-center text-text-muted hover:text-text hover:border-text-muted transition-colors min-h-[88px]">
          <span className="text-sm">+ New Project</span>
        </button>
      </div>

      {/* Activity feed */}
      <div className="mb-6">
        <h2 className="text-xs text-text-muted uppercase tracking-wider mb-3">Recent Activity</h2>
        <div className="border border-border bg-bg-surface">
          {activity.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-text-muted">No recent activity</div>
          )}
          {activity.map((item) => (
            <div
              key={item.id}
              className="flex gap-3 px-3 py-1.5 border-b border-border/50 last:border-b-0 text-[11px]"
            >
              <span className="text-text-muted shrink-0 w-10 text-right tabular-nums">
                {item.time}
              </span>
              <span className="text-accent shrink-0 font-semibold w-12">
                {item.project}
              </span>
              <span className="text-text truncate min-w-0">
                {item.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
