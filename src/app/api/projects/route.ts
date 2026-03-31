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

interface ChattrConfig {
  agentchattr_url?: string;
  agentchattr_token?: string;
  projects: ProjectConfig[];
}

function getConfig(): ChattrConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { projects: [] };
  }
}

let backendAlive: boolean | null = null;

function checkBackendAlive(projectId: string): "active" | "idle" {
  // Cache the backend check for all projects in one request
  if (backendAlive === null) {
    try {
      const cfg = getConfig();
      const port = (cfg as unknown as { port?: number }).port || 3001;
      execFileSync("curl", ["-sf", "--max-time", "1", `http://127.0.0.1:${port}/api/health`], {
        encoding: "utf-8",
        timeout: 2000,
      });
      backendAlive = true;
    } catch {
      backendAlive = false;
    }
  }
  void projectId;
  return backendAlive ? "active" : "idle";
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

interface ChatMessage {
  id: number;
  sender: string;
  text: string;
  time: string;
}

async function getChatActivity(cfg: ChattrConfig): Promise<ChatMessage[]> {
  const url = cfg.agentchattr_url || "http://127.0.0.1:8300";
  const token = cfg.agentchattr_token;
  const headers: Record<string, string> = token ? { "x-session-token": token } : {};

  try {
    const res = await fetch(`${url}/api/messages?channel=general&limit=30`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : data.messages || [];
  } catch {
    return [];
  }
}

function getProjectData(repo: string, agents: Record<string, unknown> | undefined) {
  if (!REPO_RE.test(repo)) {
    return { openPrs: 0, lastActivity: null };
  }

  const prs = ghJson(["pr", "list", "-R", repo, "--json", "number", "--limit", "100"]);

  // Get last activity from most recent PR or event
  const recentPrs = ghJson(["pr", "list", "-R", repo, "--state", "all", "--json", "updatedAt", "--limit", "1"]) as { updatedAt: string }[];
  const lastActivity = recentPrs[0]?.updatedAt || null;

  return {
    openPrs: prs.length,
    lastActivity,
  };
}

export async function GET() {
  backendAlive = null; // Reset per-request
  const cfg = getConfig();

  // Fetch chat messages for activity feed (has correct agent names)
  const chatMsgs = await getChatActivity(cfg);

  // Filter for workflow events (PR, merge, push, approve mentions)
  const eventKeywords = /\b(PR|merged|pushed|approved|opened|closed|review|commit)\b/i;
  const workflowMsgs = chatMsgs
    .filter((m) => eventKeywords.test(m.text) && m.sender !== "system")
    .slice(-10)
    .reverse();

  const projects = cfg.projects.map((p: ProjectConfig) => {
    const data = getProjectData(p.repo, p.agents);
    const hasAgents = p.agents && Object.keys(p.agents).length > 0;

    return {
      id: p.id,
      name: p.name,
      repo: p.repo,
      agentCount: p.agents ? Object.keys(p.agents).length : 0,
      openPrs: data.openPrs,
      // Active = backend server has active PTY sessions for this project
      // True process monitoring comes in #12 (agent lifecycle); for now check backend health
      state: hasAgents ? checkBackendAlive(p.id) : "idle",
      lastActivity: data.lastActivity,
    };
  });

  // Build activity feed from chat with correct agent identities
  const recentEvents = workflowMsgs.map((m) => ({
    time: m.time,
    text: m.text.length > 120 ? m.text.slice(0, 120) + "…" : m.text,
    actor: m.sender,
    // Match project by repo or name mention in message text
    projectName: cfg.projects.find((p) => m.text.includes(p.repo) || m.text.includes(p.name))?.name || "",
  }));

  return NextResponse.json({ projects, recentEvents });
}
