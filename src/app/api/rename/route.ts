import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

const CONFIG_PATH = path.join(os.homedir(), ".quadwork", "config.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return { projects: [] };
  }
}

function writeConfig(cfg: unknown) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// POST /api/rename — propagate name changes
export async function POST(req: NextRequest) {
  const { type, projectId, oldName, newName, agentId } = await req.json();
  const cfg = readConfig();
  const project = cfg.projects?.find((p: { id: string }) => p.id === projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const changes: string[] = [];

  if (type === "project") {
    // Update project name in config
    project.name = newName;
    changes.push("config.json");

    // Update trigger message if it references old name
    if (project.trigger_message && project.trigger_message.includes(oldName)) {
      project.trigger_message = project.trigger_message.replaceAll(oldName, newName);
      changes.push("trigger_message");
    }
  }

  if (type === "agent" && agentId) {
    const agent = project.agents?.[agentId];
    if (agent) {
      const oldDisplayName = agent.display_name || agentId.toUpperCase();
      agent.display_name = newName;
      changes.push("config.json");

      // Update AGENTS.md seed if it references old display name
      if (agent.agents_md && agent.agents_md.includes(oldDisplayName)) {
        agent.agents_md = agent.agents_md.replaceAll(oldDisplayName, newName);
        changes.push("agents_md");
      }

      // Update trigger message @mentions
      if (project.trigger_message) {
        // Replace @oldName with @newName in trigger message
        const oldMention = `@${oldDisplayName.toLowerCase()}`;
        const newMention = `@${newName.toLowerCase()}`;
        if (project.trigger_message.includes(oldMention)) {
          project.trigger_message = project.trigger_message.replaceAll(oldMention, newMention);
          changes.push("trigger_message");
        }
      }
    }
  }

  writeConfig(cfg);

  // Notify backend to sync triggers
  const port = cfg.port || 3001;
  fetch(`http://127.0.0.1:${port}/api/triggers/sync`, { method: "POST" }).catch(() => {});

  return NextResponse.json({ ok: true, changes });
}
