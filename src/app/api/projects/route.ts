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

interface GhEvent {
  type: string;
  actor: { login: string };
  created_at: string;
  payload: {
    action?: string;
    pull_request?: { number: number; title: string };
    ref?: string;
    size?: number;
    review?: { state: string };
  };
}

function formatEvent(e: GhEvent): string {
  const actor = e.actor?.login || "unknown";
  switch (e.type) {
    case "PushEvent":
      return `${actor} pushed to ${e.payload.ref?.replace("refs/heads/", "") || "branch"}`;
    case "PullRequestEvent": {
      const pr = e.payload.pull_request;
      return `${actor} ${e.payload.action || "updated"} PR #${pr?.number || "?"}: ${pr?.title || ""}`;
    }
    case "PullRequestReviewEvent": {
      const pr = e.payload.pull_request;
      const state = e.payload.review?.state?.toLowerCase() || "reviewed";
      return `${actor} ${state} PR #${pr?.number || "?"}: ${pr?.title || ""}`;
    }
    case "IssuesEvent":
      return `${actor} ${e.payload.action || "updated"} an issue`;
    default:
      return `${actor}: ${e.type}`;
  }
}

function getProjectData(repo: string, agents: Record<string, unknown> | undefined) {
  if (!REPO_RE.test(repo)) {
    return { openPrs: 0, state: "idle", lastActivity: null, recentEvents: [] };
  }

  const prs = ghJson(["pr", "list", "-R", repo, "--json", "number", "--limit", "100"]);
  const openPrs = prs.length;

  // Fetch recent GitHub events for rich activity feed
  const events = ghJson(["api", `repos/${repo}/events`, "--jq", ".[0:10]"]) as GhEvent[];

  const recentEvents = events.map((e) => ({
    time: e.created_at,
    text: formatEvent(e),
  }));

  const lastActivity = events[0]?.created_at || null;

  // Active = agents configured AND recent activity (push/PR event in last hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const hasAgents = agents && Object.keys(agents).length > 0;
  const hasRecentActivity = lastActivity && lastActivity > oneHourAgo;
  const state = hasAgents && hasRecentActivity ? "active" : "idle";

  return { openPrs, state, lastActivity, recentEvents: recentEvents.slice(0, 5) };
}

export async function GET() {
  const cfg = getConfig();

  const projects = cfg.projects.map((p: ProjectConfig) => {
    const data = getProjectData(p.repo, p.agents);
    return {
      id: p.id,
      name: p.name,
      repo: p.repo,
      agentCount: p.agents ? Object.keys(p.agents).length : 0,
      openPrs: data.openPrs,
      state: data.state,
      lastActivity: data.lastActivity,
      recentEvents: data.recentEvents,
    };
  });

  return NextResponse.json(projects);
}
