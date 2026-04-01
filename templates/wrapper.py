#!/usr/bin/env python3
"""Agent process wrapper — manages lifecycle, auto-trigger, and REMINDER injection.

Usage:
    python wrapper.py --agent <agent_id> --config <config_path> [--project <project_id>]

This is an optional advanced template for automating agent process management.
Copy to your project and customize as needed.
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time

def load_config(config_path: str) -> dict:
    with open(config_path) as f:
        return json.load(f)

def resolve_agent(config: dict, project_id: str, agent_id: str) -> dict | None:
    for project in config.get("projects", []):
        if project.get("id") == project_id:
            return project.get("agents", {}).get(agent_id)
    return None

def run_agent(agent: dict, agent_id: str) -> subprocess.Popen:
    command = agent.get("command", os.environ.get("SHELL", "/bin/zsh"))
    cwd = agent.get("cwd", os.getcwd())
    env = {**os.environ, "QUADWORK_AGENT": agent_id}

    proc = subprocess.Popen(
        [command],
        cwd=cwd,
        env=env,
        stdin=sys.stdin,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
    return proc

def main():
    parser = argparse.ArgumentParser(description="Agent process wrapper")
    parser.add_argument("--agent", required=True, help="Agent ID (e.g. t3)")
    parser.add_argument("--config", required=True, help="Path to config.json")
    parser.add_argument("--project", default=None, help="Project ID (uses first project if omitted)")
    args = parser.parse_args()

    config = load_config(args.config)
    project_id = args.project or config.get("projects", [{}])[0].get("id", "")
    agent = resolve_agent(config, project_id, args.agent)

    if not agent:
        print(f"Agent '{args.agent}' not found in project '{project_id}'", file=sys.stderr)
        sys.exit(1)

    proc = run_agent(agent, args.agent)

    def handle_signal(signum, _frame):
        proc.send_signal(signum)

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    sys.exit(proc.wait())

if __name__ == "__main__":
    main()
