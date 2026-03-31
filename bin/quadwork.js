#!/usr/bin/env node

const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const readline = require("readline");

// ─── Constants ──────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), ".quadwork");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");
const TEMPLATES_DIR = path.join(__dirname, "..", "templates");
const AGENTS = ["t1", "t2a", "t2b", "t3"];

// ─── Helpers ────────────────────────────────────────────────────────────────

function log(msg) { console.log(`  ${msg}`); }
function ok(msg) { console.log(`  ✓ ${msg}`); }
function warn(msg) { console.log(`  ⚠ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); }
function header(msg) { console.log(`\n── ${msg} ${"─".repeat(Math.max(0, 58 - msg.length))}\n`); }

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: "pipe", ...opts }).trim();
  } catch {
    return null;
  }
}

function which(cmd) {
  return run(`which ${cmd}`) !== null;
}

function ask(rl, question, defaultVal) {
  return new Promise((resolve) => {
    const suffix = defaultVal ? ` (${defaultVal})` : "";
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || "");
    });
  });
}

function askYN(rl, question, defaultYes = false) {
  return new Promise((resolve) => {
    const hint = defaultYes ? "Y/n" : "y/N";
    rl.question(`  ${question} [${hint}]: `, (answer) => {
      const a = answer.trim().toLowerCase();
      resolve(a === "" ? defaultYes : a === "y" || a === "yes");
    });
  });
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return { port: 3001, agentchattr_url: "http://127.0.0.1:8300", projects: [] };
  }
}

function writeConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ─── Prerequisites ──────────────────────────────────────────────────────────

function checkPrereqs() {
  header("Step 1: Prerequisites");
  let allOk = true;

  // Node.js 20+
  const nodeVer = run("node --version");
  if (nodeVer) {
    const major = parseInt(nodeVer.replace("v", "").split(".")[0], 10);
    if (major >= 20) ok(`Node.js ${nodeVer}`);
    else { fail(`Node.js ${nodeVer} — need 20+`); allOk = false; }
  } else { fail("Node.js not found"); allOk = false; }

  // Python 3.10+
  const pyVer = run("python3 --version");
  if (pyVer) {
    const parts = pyVer.replace("Python ", "").split(".");
    const minor = parseInt(parts[1], 10);
    if (parseInt(parts[0], 10) >= 3 && minor >= 10) ok(`${pyVer}`);
    else { fail(`${pyVer} — need 3.10+`); allOk = false; }
  } else { fail("Python 3 not found"); allOk = false; }

  // AgentChattr
  const acVer = run("agentchattr --version") || run("python3 -m agentchattr --version");
  if (acVer) ok(`AgentChattr ${acVer}`);
  else { warn("AgentChattr not found — install: pip install agentchattr"); allOk = false; }

  // gh CLI
  if (which("gh")) ok("GitHub CLI (gh)");
  else { fail("GitHub CLI not found — install: https://cli.github.com"); allOk = false; }

  // Claude Code or Codex
  const hasClaude = which("claude");
  const hasCodex = which("codex");
  if (hasClaude) ok("Claude Code");
  if (hasCodex) ok("Codex CLI");
  if (!hasClaude && !hasCodex) {
    fail("No AI CLI found — install Claude Code or Codex CLI");
    allOk = false;
  }

  return allOk;
}

// ─── GitHub ─────────────────────────────────────────────────────────────────

async function setupGitHub(rl) {
  header("Step 2: GitHub Connection");

  // Check auth
  const authStatus = run("gh auth status 2>&1");
  if (authStatus && authStatus.includes("Logged in")) {
    ok("GitHub authenticated");
  } else {
    fail("Not authenticated with GitHub — run: gh auth login");
    return null;
  }

  const repo = await ask(rl, "GitHub repo (owner/repo)", "");
  if (!repo || !repo.includes("/")) {
    fail("Invalid repo format — use owner/repo");
    return null;
  }

  // Verify repo exists
  const repoCheck = run(`gh repo view ${repo} --json name 2>&1`);
  if (repoCheck && repoCheck.includes('"name"')) {
    ok(`Repo ${repo} verified`);
  } else {
    fail(`Cannot access ${repo} — check permissions`);
    return null;
  }

  return repo;
}

// ─── Agent Configuration ────────────────────────────────────────────────────

async function setupAgents(rl, repo) {
  header("Step 3: Agent Configuration");

  const projectDir = await ask(rl, "Project directory", process.cwd());
  const absDir = path.resolve(projectDir);

  if (!fs.existsSync(absDir)) {
    fail(`Directory not found: ${absDir}`);
    return null;
  }

  // Check if it's a git repo
  if (!fs.existsSync(path.join(absDir, ".git"))) {
    fail(`Not a git repo: ${absDir}`);
    return null;
  }

  const projectName = path.basename(absDir);
  log(`Project: ${projectName}`);
  log("Creating worktrees for 4 agents...\n");

  const worktrees = {};
  for (const agent of AGENTS) {
    const wtDir = path.join(path.dirname(absDir), `${projectName}-${agent}`);
    if (fs.existsSync(wtDir)) {
      ok(`Worktree exists: ${agent} → ${wtDir}`);
    } else {
      const branchName = `worktree-${agent}`;
      // Create branch if needed
      run(`git -C "${absDir}" branch ${branchName} HEAD 2>&1`);
      const result = run(`git -C "${absDir}" worktree add "${wtDir}" ${branchName} 2>&1`);
      if (result !== null) {
        ok(`Created worktree: ${agent} → ${wtDir}`);
      } else {
        // Try without branch (detached)
        const result2 = run(`git -C "${absDir}" worktree add --detach "${wtDir}" HEAD 2>&1`);
        if (result2 !== null) ok(`Created worktree (detached): ${agent} → ${wtDir}`);
        else { fail(`Failed to create worktree for ${agent}`); return null; }
      }
    }
    worktrees[agent] = wtDir;

    // Copy AGENTS.md seed
    const seedSrc = path.join(TEMPLATES_DIR, "seeds", `${agent}.AGENTS.md`);
    const seedDst = path.join(wtDir, "AGENTS.md");
    if (fs.existsSync(seedSrc)) {
      fs.copyFileSync(seedSrc, seedDst);
      log(`  Copied ${agent}.AGENTS.md`);
    }
  }

  // Copy CLAUDE.md to each worktree
  const claudeSrc = path.join(TEMPLATES_DIR, "CLAUDE.md");
  if (fs.existsSync(claudeSrc)) {
    let claudeContent = fs.readFileSync(claudeSrc, "utf-8");
    claudeContent = claudeContent.replace(/\{\{project_name\}\}/g, projectName);
    for (const agent of AGENTS) {
      const dst = path.join(worktrees[agent], "CLAUDE.md");
      // Don't overwrite if CLAUDE.md already exists
      if (!fs.existsSync(dst)) {
        fs.writeFileSync(dst, claudeContent);
      }
    }
    ok("Copied CLAUDE.md to all worktrees");
  }

  return { projectName, absDir, worktrees, repo };
}

// ─── AgentChattr Config ─────────────────────────────────────────────────────

function writeAgentChattrConfig(setup, configTomlPath) {
  header("Step 4: AgentChattr Setup");

  let tomlContent = fs.readFileSync(path.join(TEMPLATES_DIR, "config.toml"), "utf-8");
  for (const agent of AGENTS) {
    tomlContent = tomlContent.replace(`{{${agent}_cwd}}`, setup.worktrees[agent]);
  }

  // Write config.toml
  const configDir = path.dirname(configTomlPath);
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configTomlPath, tomlContent);
  ok(`Wrote ${configTomlPath}`);

  return configTomlPath;
}

// ─── Optional Add-ons ───────────────────────────────────────────────────────

async function setupAddons(rl, setup, configTomlPath) {
  header("Step 5: Optional Add-ons");

  // Telegram Bridge
  const wantTelegram = await askYN(rl, "Set up Telegram Bridge?", false);
  if (wantTelegram) {
    const telegramDir = path.join(path.dirname(setup.absDir), "agentchattr-telegram");
    if (!fs.existsSync(telegramDir)) {
      log("Cloning agentchattr-telegram...");
      const cloneResult = run(`git clone https://github.com/realproject7/agentchattr-telegram.git "${telegramDir}" 2>&1`);
      if (cloneResult !== null) ok("Cloned agentchattr-telegram");
      else warn("Failed to clone — you can set it up manually later");
    } else {
      ok("agentchattr-telegram already present");
    }

    if (fs.existsSync(telegramDir)) {
      const reqFile = path.join(telegramDir, "requirements.txt");
      if (fs.existsSync(reqFile)) {
        run(`pip install -r "${reqFile}" 2>&1`);
        ok("Installed Telegram Bridge dependencies");
      }

      const botToken = await ask(rl, "Telegram bot token", "");
      const chatId = await ask(rl, "Telegram chat ID", "");

      if (botToken && chatId) {
        // Append telegram section to config.toml
        const telegramSection = `
[telegram]
bot_token = "${botToken}"
chat_id = "${chatId}"
agentchattr_url = "http://127.0.0.1:8300"
poll_interval = 2
bridge_sender = "telegram-bridge"
`;
        fs.appendFileSync(configTomlPath, telegramSection);
        ok("Added Telegram config to config.toml");
      }
    }
  }

  // Shared Memory
  const wantMemory = await askYN(rl, "Set up Shared Memory?", false);
  if (wantMemory) {
    const memoryDir = path.join(path.dirname(setup.absDir), "agent-memory");
    if (!fs.existsSync(memoryDir)) {
      log("Cloning agent-memory...");
      const cloneResult = run(`git clone https://github.com/realproject7/agent-memory.git "${memoryDir}" 2>&1`);
      if (cloneResult !== null) ok("Cloned agent-memory");
      else warn("Failed to clone — you can set it up manually later");
    } else {
      ok("agent-memory already present");
    }

    setup.memoryDir = memoryDir;
  }

  return setup;
}

// ─── Write QuadWork Config ──────────────────────────────────────────────────

function writeQuadWorkConfig(setup) {
  header("Writing QuadWork Config");

  const config = readConfig();

  const project = {
    id: setup.projectName,
    name: setup.projectName,
    repo: setup.repo,
    working_dir: setup.absDir,
    agents: {},
  };

  for (const agent of AGENTS) {
    project.agents[agent] = { cwd: setup.worktrees[agent] };
  }

  if (setup.memoryDir) {
    project.memory_cards_dir = path.join(setup.memoryDir, "archive", "v2", "cards");
    project.shared_memory_path = path.join(setup.memoryDir, "central", "short-term", `${setup.projectName}.md`);
    project.butler_scripts_dir = path.join(setup.memoryDir, "scripts");
  }

  // Upsert project
  const idx = config.projects.findIndex((p) => p.id === setup.projectName);
  if (idx >= 0) config.projects[idx] = project;
  else config.projects.push(project);

  writeConfig(config);
  ok(`Wrote ${CONFIG_PATH}`);
}

// ─── Init Command ───────────────────────────────────────────────────────────

async function cmdInit() {
  console.log("\n  QuadWork Init — 4-agent coding team setup\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Step 1: Prerequisites
    const prereqsOk = checkPrereqs();
    if (!prereqsOk) {
      const proceed = await askYN(rl, "Some prerequisites missing. Continue anyway?", false);
      if (!proceed) { rl.close(); process.exit(1); }
    }

    // Step 2: GitHub
    const repo = await setupGitHub(rl);
    if (!repo) { rl.close(); process.exit(1); }

    // Step 3: Agents
    const setup = await setupAgents(rl, repo);
    if (!setup) { rl.close(); process.exit(1); }

    // Step 4: AgentChattr config
    const configTomlPath = path.join(setup.absDir, "config.toml");
    writeAgentChattrConfig(setup, configTomlPath);

    // Step 5: Optional add-ons
    await setupAddons(rl, setup, configTomlPath);

    // Write QuadWork config
    writeQuadWorkConfig(setup);

    // Done
    header("Setup Complete");
    log(`Project:      ${setup.projectName}`);
    log(`Repo:         ${setup.repo}`);
    log(`Worktrees:    ${AGENTS.map((a) => `${a}/`).join(", ")}`);
    log(`Config:       ${CONFIG_PATH}`);
    log(`AgentChattr:  ${configTomlPath}`);
    log("");
    log("Next steps:");
    log("  npx quadwork start    — launch dashboard + agents");
    log("  npx quadwork stop     — stop all processes");
    log("");

    rl.close();
  } catch (err) {
    fail(err.message);
    rl.close();
    process.exit(1);
  }
}

// ─── Start Command ──────────────────────────────────────────────────────────

function cmdStart() {
  console.log("\n  QuadWork Start\n");

  const config = readConfig();
  if (config.projects.length === 0) {
    fail("No projects configured. Run: npx quadwork init");
    process.exit(1);
  }

  // Start QuadWork backend server
  const serverDir = path.join(__dirname, "..", "server");
  if (!fs.existsSync(path.join(serverDir, "index.js"))) {
    fail("Server not found. Run from the quadwork directory.");
    process.exit(1);
  }

  log("Starting QuadWork backend...");
  const server = spawn("node", [serverDir], {
    stdio: "inherit",
    detached: true,
    env: { ...process.env },
  });
  server.unref();
  ok(`Backend started (PID: ${server.pid})`);

  // Save PID for stop command
  const pidFile = path.join(CONFIG_DIR, "server.pid");
  fs.writeFileSync(pidFile, String(server.pid));

  const port = config.port || 3001;
  log(`Dashboard: http://localhost:${port === 3001 ? 3000 : port}`);
  log("");
}

// ─── Stop Command ───────────────────────────────────────────────────────────

function cmdStop() {
  console.log("\n  QuadWork Stop\n");

  const pidFile = path.join(CONFIG_DIR, "server.pid");
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
    try {
      process.kill(pid, "SIGTERM");
      ok(`Stopped server (PID: ${pid})`);
    } catch {
      warn(`Server process ${pid} not running`);
    }
    fs.unlinkSync(pidFile);
  } else {
    warn("No server PID file found");
  }
  log("");
}

// ─── Add Project Command ────────────────────────────────────────────────────

async function cmdAddProject() {
  console.log("\n  QuadWork — Add Project\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const repo = await setupGitHub(rl);
    if (!repo) { rl.close(); process.exit(1); }

    const setup = await setupAgents(rl, repo);
    if (!setup) { rl.close(); process.exit(1); }

    const configTomlPath = path.join(setup.absDir, "config.toml");
    writeAgentChattrConfig(setup, configTomlPath);

    writeQuadWorkConfig(setup);

    header("Project Added");
    log(`Project:      ${setup.projectName}`);
    log(`Repo:         ${setup.repo}`);
    log(`Worktrees:    ${AGENTS.map((a) => `${a}/`).join(", ")}`);
    log("");

    rl.close();
  } catch (err) {
    fail(err.message);
    rl.close();
    process.exit(1);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

const command = process.argv[2];

switch (command) {
  case "init":
    cmdInit();
    break;
  case "start":
    cmdStart();
    break;
  case "stop":
    cmdStop();
    break;
  case "add-project":
    cmdAddProject();
    break;
  default:
    console.log(`
  Usage: quadwork <command>

  Commands:
    init          Set up a new QuadWork 4-agent environment
    start         Start the QuadWork dashboard and backend
    stop          Stop all QuadWork processes
    add-project   Add a project to an existing QuadWork setup

  Examples:
    npx quadwork init
    npx quadwork start
    npx quadwork stop
    npx quadwork add-project
`);
    if (command) process.exit(1);
}
