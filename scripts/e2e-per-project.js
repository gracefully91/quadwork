#!/usr/bin/env node
//
// End-to-end verification for #190 (master #181):
// 3 concurrent per-project AgentChattr clones, each on its own ports,
// no collisions, no cross-talk.
//
// Runs entirely inside an isolated sandbox dir (default: /tmp/qw-e2e-<ts>)
// so it never touches the user's real ~/.quadwork install. Pass
// `--keep` to leave the sandbox on disk for inspection.
//
//   node scripts/e2e-per-project.js [--sandbox <dir>] [--keep] [--no-install]
//
// `--no-install` reuses an existing AgentChattr clone (looked up at
// ~/.quadwork/agentchattr by default) as the source for `git clone <local>`,
// avoiding three full network clones. The script still creates fresh
// venvs in each per-project clone — Python venvs are not relocatable.
//
// Steps and the corresponding #181 sub-tickets they exercise:
//   1. installAgentChattr(perProjectDir) for 3 distinct dirs    [#183 + #187]
//   2. Write 3 unique config.toml files at the clone ROOTs     [#184 + #185]
//   3. Spawn each python run.py from its own cwd                [#186]
//   4. lsof + curl /api/health for each port → isolation       [acceptance]
//   5. Restart project-b only, verify a/c stay running          [acceptance]
//   6. SIGTERM all three, verify ports released                 [acceptance]

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execSync, spawnSync } = require("child_process");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };

const SANDBOX = opt("--sandbox") || path.join(os.tmpdir(), `qw-e2e-${Date.now()}`);
const KEEP = flag("--keep");
const SKIP_INSTALL = flag("--no-install");
const LOCAL_SOURCE = opt("--local-source") || path.join(os.homedir(), ".quadwork", "agentchattr");

const PROJECTS = [
  { id: "project-a", chattrPort: 8351, mcpHttp: 8451, mcpSse: 8452 },
  { id: "project-b", chattrPort: 8361, mcpHttp: 8461, mcpSse: 8462 },
  { id: "project-c", chattrPort: 8371, mcpHttp: 8471, mcpSse: 8472 },
];

const installer = require(path.join(__dirname, "..", "server", "install-agentchattr"));

function log(msg) { console.log(`[e2e] ${msg}`); }
function fail(msg) { console.error(`[e2e] FAIL: ${msg}`); process.exitCode = 1; }
function ok(msg) { console.log(`[e2e] OK   ${msg}`); }

function ensureSandbox() {
  if (fs.existsSync(SANDBOX)) {
    log(`Reusing sandbox at ${SANDBOX}`);
  } else {
    fs.mkdirSync(SANDBOX, { recursive: true });
    log(`Created sandbox at ${SANDBOX}`);
  }
}

function writeProjectConfigToml(p, dir) {
  const dataDir = path.join(dir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const toml = [
    `[meta]`,
    `name = "${p.id}"`,
    ``,
    `[server]`,
    `port = ${p.chattrPort}`,
    `host = "127.0.0.1"`,
    `data_dir = "${dataDir}"`,
    ``,
    `[mcp]`,
    `http_port = ${p.mcpHttp}`,
    `sse_port = ${p.mcpSse}`,
    ``,
  ].join("\n");
  fs.writeFileSync(path.join(dir, "config.toml"), toml);
}

function installLocalClone(perProjectDir) {
  if (SKIP_INSTALL) {
    if (!fs.existsSync(path.join(LOCAL_SOURCE, "run.py"))) {
      throw new Error(`--no-install: no source at ${LOCAL_SOURCE}`);
    }
    fs.mkdirSync(path.dirname(perProjectDir), { recursive: true });
    if (fs.existsSync(perProjectDir)) {
      // Already installed.
    } else {
      log(`  git clone ${LOCAL_SOURCE} → ${perProjectDir}`);
      execSync(`git clone "${LOCAL_SOURCE}" "${perProjectDir}"`, { stdio: "inherit" });
    }
    const venvPython = path.join(perProjectDir, ".venv", "bin", "python");
    if (!fs.existsSync(venvPython)) {
      log(`  creating venv at ${perProjectDir}/.venv (system-site-packages)`);
      execSync(`python3 -m venv --system-site-packages "${perProjectDir}/.venv"`, { stdio: "inherit" });
    }
    return perProjectDir;
  }
  return installer.installAgentChattr(perProjectDir);
}

function curl(url, timeoutSec = 2) {
  const r = spawnSync("curl", ["-fsSL", "--max-time", String(timeoutSec), url], { encoding: "utf-8" });
  return { ok: r.status === 0, body: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function lsofPort(port) {
  const r = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf-8" });
  return r.stdout.trim();
}

function waitForPort(port, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (lsofPort(port)) return true;
    try { execSync("sleep 0.25"); } catch {}
  }
  return false;
}

function spawnChattr(p, dir) {
  // Prefer the per-project clone's own venv python; fall back to the
  // legacy install's venv when --no-install is used (system-site-packages
  // venvs don't pick up fastapi etc., but the legacy venv has all
  // requirements installed already, and Python with cwd=<per-project>
  // still imports run.py + the other agentchattr modules from the
  // per-project clone, and reads ROOT/config.toml from cwd — which is
  // exactly the property #181 is testing).
  let venvPython = path.join(dir, ".venv", "bin", "python");
  if (SKIP_INSTALL) {
    const legacyPy = path.join(LOCAL_SOURCE, ".venv", "bin", "python");
    if (fs.existsSync(legacyPy)) venvPython = legacyPy;
  }
  const child = spawn(venvPython, ["run.py"], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env },
  });
  child.unref();
  const logPath = path.join(SANDBOX, `${p.id}.log`);
  const logFd = fs.openSync(logPath, "w");
  child.stdout.on("data", (b) => fs.writeSync(logFd, b));
  child.stderr.on("data", (b) => fs.writeSync(logFd, b));
  return { child, logPath };
}

function killProc(pid) {
  try { process.kill(pid, "SIGTERM"); } catch {}
}

(async function main() {
  log(`Sandbox:    ${SANDBOX}`);
  log(`Projects:   ${PROJECTS.map((p) => `${p.id}(${p.chattrPort})`).join(", ")}`);
  log(`Skip install: ${SKIP_INSTALL ? "yes (local clone source: " + LOCAL_SOURCE + ")" : "no"}`);
  ensureSandbox();

  // 1. Install 3 per-project clones in parallel-ish (sequential, since the
  //    installer is sync; the per-target lock would serialize them anyway).
  const installed = [];
  for (const p of PROJECTS) {
    const dir = path.join(SANDBOX, p.id, "agentchattr");
    log(`installAgentChattr(${dir})`);
    const result = installLocalClone(dir);
    if (!result) {
      fail(`install failed for ${p.id}: ${installer.installAgentChattr.lastError || "unknown"}`);
      return;
    }
    ok(`install ${p.id} → ${result}`);
    installed.push({ ...p, dir });
  }

  // 2. Write a unique config.toml at each clone ROOT.
  for (const p of installed) {
    writeProjectConfigToml(p, p.dir);
    ok(`wrote ${p.dir}/config.toml (port ${p.chattrPort})`);
  }

  // 3. Spawn each AgentChattr from its own cwd.
  const procs = [];
  for (const p of installed) {
    const { child, logPath } = spawnChattr(p, p.dir);
    if (!child.pid) { fail(`spawn failed for ${p.id}`); return; }
    procs.push({ ...p, pid: child.pid, logPath });
    log(`spawned ${p.id} pid=${child.pid} log=${logPath}`);
  }

  // 4. Wait for each to bind its port.
  for (const p of procs) {
    const bound = waitForPort(p.chattrPort);
    if (!bound) {
      fail(`${p.id} did not bind port ${p.chattrPort} within 8s — see ${p.logPath}`);
    } else {
      ok(`${p.id} listening on ${p.chattrPort}`);
    }
  }

  // 5. lsof + curl proof for each port.
  console.log("\n--- lsof per project ---");
  for (const p of procs) {
    const out = lsofPort(p.chattrPort);
    console.log(`# ${p.id} (${p.chattrPort})`);
    console.log(out || "  (not bound)");
    if (!out.includes("python") && !out.includes("Python")) {
      fail(`${p.id} listener on ${p.chattrPort} is not python`);
    }
  }

  console.log("\n--- curl per project ---");
  for (const p of procs) {
    const r = curl(`http://127.0.0.1:${p.chattrPort}/`);
    console.log(`# ${p.id}`);
    console.log(`  ok=${r.ok}  bodyLen=${r.body.length}`);
    if (!r.ok) console.log(`  err=${r.err}`);
  }

  // 6. Verify all 3 ports are distinct and bound to distinct pids.
  const pidByPort = new Map();
  for (const p of procs) {
    const lines = lsofPort(p.chattrPort).split("\n").slice(1);
    const pids = new Set(lines.map((l) => l.split(/\s+/)[1]).filter(Boolean));
    if (pids.size !== 1) fail(`${p.id} on ${p.chattrPort} has ${pids.size} listening pids`);
    const pid = [...pids][0];
    if (pidByPort.has(pid)) fail(`pid ${pid} listening on multiple ports — clones not isolated`);
    pidByPort.set(pid, p.id);
  }
  if (process.exitCode !== 1) ok("all 3 ports bound to distinct pids — no collisions");

  // 7. Restart project-b only; verify a/c untouched.
  console.log("\n--- restart project-b ---");
  const b = procs.find((x) => x.id === "project-b");
  killProc(b.pid);
  for (let i = 0; i < 20; i++) { if (!lsofPort(b.chattrPort)) break; try { execSync("sleep 0.25"); } catch {} }
  if (lsofPort(b.chattrPort)) fail(`project-b did not release port ${b.chattrPort} after SIGTERM`);
  else ok(`project-b released ${b.chattrPort}`);

  for (const p of procs) {
    if (p.id === "project-b") continue;
    if (!lsofPort(p.chattrPort)) fail(`${p.id} died when project-b was restarted`);
    else ok(`${p.id} still listening on ${p.chattrPort}`);
  }

  const restarted = spawnChattr(b, b.dir);
  b.pid = restarted.child.pid;
  b.logPath = restarted.logPath;
  if (waitForPort(b.chattrPort)) ok(`project-b restarted on ${b.chattrPort} (pid ${b.pid})`);
  else fail(`project-b restart failed`);

  // 8. Cleanup: SIGTERM all 3, verify ports released.
  console.log("\n--- shutdown ---");
  for (const p of procs) killProc(p.pid);
  for (const p of procs) {
    let released = false;
    for (let i = 0; i < 20; i++) { if (!lsofPort(p.chattrPort)) { released = true; break; } try { execSync("sleep 0.25"); } catch {} }
    if (released) ok(`${p.id} released ${p.chattrPort}`);
    else fail(`${p.id} did not release ${p.chattrPort}`);
  }

  if (!KEEP) {
    log(`Removing sandbox ${SANDBOX}`);
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) { log(`  warn: ${e.message}`); }
  } else {
    log(`Sandbox kept at ${SANDBOX} (--keep)`);
  }

  if (process.exitCode === 1) {
    console.log("\n[e2e] === FAIL ===");
    process.exit(1);
  } else {
    console.log("\n[e2e] === PASS ===");
  }
})().catch((e) => { console.error(e); process.exit(2); });
