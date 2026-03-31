import { NextResponse } from "next/server";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_PATH = path.join(os.homedir(), ".quadwork", "config.json");
const REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

interface ProjectConfig {
  id: string;
  name: string;
  repo: string;
  agents?: Record<string, unknown>;
}

function getConfig(): { projects: ProjectConfig[] } {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { projects: [] };
  }
}

function ghJson(args: string[]): unknown[] {
  try {
    const out = execFileSync("gh", args, { encoding: "utf-8", timeout: 15000 });
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getProjectData(repo: string) {
  if (!REPO_RE.test(repo)) return { openPrs: 0, lastActivity: null, recentEvents: [] };

  const prs = ghJson(["pr", "list", "-R", repo, "--json", "number,title,createdAt,author", "--limit", "100"]);
  const openPrs = prs.length;

  // Get recent events: last 5 merged PRs + last 5 closed issues
  const mergedPrs = ghJson(["pr", "list", "-R", repo, "--state", "merged", "--json", "number,title,mergedAt,author", "--limit", "5"]);
  const events: { time: string; text: string }[] = [];

  for (const pr of prs.slice(0, 3) as { number: number; title: string; createdAt: string; author: { login: string } }[]) {
    events.push({ time: pr.createdAt, text: `PR #${pr.number} opened: ${pr.title}` });
  }
  for (const pr of mergedPrs.slice(0, 3) as { number: number; title: string; mergedAt: string; author: { login: string } }[]) {
    events.push({ time: pr.mergedAt, text: `PR #${pr.number} merged: ${pr.title}` });
  }

  // Sort by time descending
  events.sort((a, b) => (b.time || "").localeCompare(a.time || ""));

  // Last activity is the most recent event
  const lastActivity = events[0]?.time || null;

  // Active if any activity in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const state = lastActivity && lastActivity > oneHourAgo ? "active" : "idle";

  return { openPrs, lastActivity, state, recentEvents: events.slice(0, 5) };
}

export async function GET() {
  const cfg = getConfig();

  const projects = cfg.projects.map((p: ProjectConfig) => {
    const data = getProjectData(p.repo);
    return {
      id: p.id,
      name: p.name,
      repo: p.repo,
      agentCount: p.agents ? Object.keys(p.agents).length : 0,
      openPrs: data.openPrs,
      state: data.state || "idle",
      lastActivity: data.lastActivity,
      recentEvents: data.recentEvents,
    };
  });

  return NextResponse.json(projects);
}
