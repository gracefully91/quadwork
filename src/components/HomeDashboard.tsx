"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface RecentEvent {
  time: string;
  text: string;
}

interface Project {
  id: string;
  name: string;
  repo: string;
  agentCount: number;
  openPrs: number;
  state: "active" | "idle";
  lastActivity: string | null;
  recentEvents: RecentEvent[];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function HomeDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);

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
  }, []);

  // Aggregate recent events across all projects
  const allEvents = projects
    .flatMap((p) =>
      (p.recentEvents || []).map((e) => ({ ...e, projectName: p.name, projectId: p.id }))
    )
    .sort((a, b) => (b.time || "").localeCompare(a.time || ""))
    .slice(0, 10);

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
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    project.state === "active" ? "bg-accent" : "bg-text-muted"
                  }`}
                />
                <span className="text-sm font-semibold text-text">{project.name}</span>
                <span className="text-[10px] text-text-muted">
                  {project.state}
                </span>
              </div>
              <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                open →
              </span>
            </div>

            <div className="flex gap-4 text-[11px] mb-2">
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

            {project.lastActivity && (
              <div className="text-[10px] text-text-muted">
                last activity: {timeAgo(project.lastActivity)}
              </div>
            )}
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
          {allEvents.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-text-muted">No recent activity</div>
          )}
          {allEvents.map((item, i) => (
            <div
              key={`${item.time}-${i}`}
              className="flex gap-3 px-3 py-1.5 border-b border-border/50 last:border-b-0 text-[11px]"
            >
              <span className="text-text-muted shrink-0 w-14 text-right tabular-nums">
                {item.time ? timeAgo(item.time) : ""}
              </span>
              <span className="text-accent shrink-0 font-semibold">
                {item.projectName}
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
