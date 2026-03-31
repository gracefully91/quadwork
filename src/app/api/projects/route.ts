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

function getPrCount(repo: string): number {
  if (!REPO_RE.test(repo)) return 0;
  try {
    const out = execFileSync(
      "gh",
      ["pr", "list", "-R", repo, "--json", "number", "--limit", "100"],
      { encoding: "utf-8", timeout: 15000 }
    );
    return JSON.parse(out).length;
  } catch {
    return 0;
  }
}

export async function GET() {
  const cfg = getConfig();

  const projects = cfg.projects.map((p: ProjectConfig) => ({
    id: p.id,
    name: p.name,
    repo: p.repo,
    agentCount: p.agents ? Object.keys(p.agents).length : 0,
    openPrs: getPrCount(p.repo),
  }));

  return NextResponse.json(projects);
}
