// #341 / quadwork#341: parseActiveBatch regex tests. Plain
// node:assert script — no test runner is wired up. Run with
// `node server/routes.parseActiveBatch.test.js`.
//
// parseActiveBatch is re-exported from server/routes.js for this
// test only; it has no production callers outside routes.js.

const assert = require("node:assert/strict");
const { parseActiveBatch } = require("./routes");

function wrap(body, batchLine = "**Batch:** 33") {
  return `# Overnight Queue\n\n## Active Batch\n\n${batchLine}\n\n${body}\n\n## Backlog\n\n- #999 something else\n`;
}

// 1) #341 regression: GFM checkbox items (space between `[` and `#`)
//    must populate the list.
{
  const text = wrap(
    [
      "- [ ] #338 — Remove home hero",
      "- [ ] #337 — Stack SERVER",
      "- [x] #332 — Commit port drafts",
      "- [X] #334 — Snapshot stale check",
    ].join("\n"),
  );
  const { batchNumber, issueNumbers } = parseActiveBatch(text);
  assert.equal(batchNumber, 33, "batch number parsed");
  assert.deepEqual(issueNumbers, [338, 337, 332, 334], "checkbox items parsed in order");
}

// 2) Existing shapes keep working.
{
  const text = wrap(
    [
      "- #295 sub-A heartbeat",
      "* #296 sub-B",
      "1. #297 sub-C",
      "#298 sub-D",
      "- [#299] sub-E",
      "[#300] sub-F",
    ].join("\n"),
  );
  const { issueNumbers } = parseActiveBatch(text);
  assert.deepEqual(issueNumbers, [295, 296, 297, 298, 299, 300], "legacy shapes still parsed");
}

// 3) Prose references still rejected.
{
  const text = wrap(
    [
      "- [ ] #400 real item",
      "Tracking umbrella: #293",
      "Assigned next after #294 merged.",
      "See #295 for context.",
    ].join("\n"),
  );
  const { issueNumbers } = parseActiveBatch(text);
  assert.deepEqual(issueNumbers, [400], "prose references rejected, only real item kept");
}

// 4) De-dup: same issue number on multiple lines collapses.
{
  const text = wrap(
    [
      "- [ ] #100 first mention",
      "- [x] #100 second mention",
      "- [ ] #101 another",
    ].join("\n"),
  );
  const { issueNumbers } = parseActiveBatch(text);
  assert.deepEqual(issueNumbers, [100, 101], "de-dup keeps first occurrence");
}

// 5) Items in Backlog section are NOT picked up.
{
  const text = wrap("- [ ] #500 active item");
  const { issueNumbers } = parseActiveBatch(text);
  assert.deepEqual(issueNumbers, [500], "Backlog section not scanned");
}

// 6) Empty / missing Active Batch returns empty.
{
  const { batchNumber, issueNumbers } = parseActiveBatch("# no active batch here\n");
  assert.equal(batchNumber, null);
  assert.deepEqual(issueNumbers, []);
}

console.log("routes.parseActiveBatch.test.js: all assertions passed (6 cases)");
