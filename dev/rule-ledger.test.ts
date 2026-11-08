import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runLedger } from "./rule-ledger.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const USAGE = "usage: bun dev/rule-ledger.ts <ledger.json> <doc.md>...";

type Target = { slice: number } | { decision: string } | { landed: string };
type Ledger = { sections?: Record<string, Target>; lines?: Record<string, Target> };

/** A tmp dir with the docs and ledger written; runs the CLI over them and returns its exit code and printed lines. */
function run(docs: Record<string, string>, ledger: Ledger | null, extraArgs: string[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-ledger-"));
  temps.push(dir);
  const docPaths = Object.entries(docs).map(([name, text]) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return file;
  });
  const ledgerPath = path.join(dir, "ledger.json");
  if (ledger !== null) fs.writeFileSync(ledgerPath, JSON.stringify({ sections: {}, lines: {}, ...ledger }));
  const lines: string[] = [];
  const code = runLedger([ledgerPath, ...docPaths, ...extraArgs], { log: (line) => lines.push(line) });
  return { code, lines, docPaths };
}

const DOC = "# Title\n\n## Alpha\n\n- [ ] first rule\n- [x] second rule\n\nprose\n\n## Beta\n\n  - [ ] third rule\n";

describe("runLedger", () => {
  it("maps each rule line through its section, at any heading level", () => {
    const doc = "# Top\n- [ ] one\n### Deep\n- [x] two\n";
    const result = run({ "a.md": doc }, { sections: { "a.md#Top": { slice: 1 }, "a.md#Deep": { decision: "D2" } } });
    expect(result.lines).toEqual(["rule ledger: 2 lines mapped (1 to slices, 1 to decisions, 0 landed); 0 unmapped; 0 stale"]);
    expect(result.code).toBe(0);
  });

  it("counts slices, decisions and landed targets, with a line key matching the exact line text", () => {
    const result = run(
      { "a.md": DOC },
      {
        sections: { "a.md#Alpha": { slice: 1 }, "a.md#Beta": { landed: "roadmap 3" } },
        lines: { "a.md#- [x] second rule": { decision: "D1" } },
      },
    );
    expect(result.lines).toEqual(["rule ledger: 3 lines mapped (1 to slices, 1 to decisions, 1 landed); 0 unmapped; 0 stale"]);
    expect(result.code).toBe(0);
  });

  it("lets a line override win over its section, only in its own doc", () => {
    const docs = { "a.md": "## Same\n- [ ] shared\n", "b.md": "## Same\n- [ ] shared\n" };
    const result = run(docs, {
      sections: { "a.md#Same": { slice: 1 }, "b.md#Same": { slice: 2 } },
      lines: { "a.md#- [ ] shared": { decision: "D9" } },
    });
    expect(result.lines).toEqual(["rule ledger: 2 lines mapped (1 to slices, 1 to decisions, 0 landed); 0 unmapped; 0 stale"]);
    expect(result.code).toBe(0);
  });

  it("reports a line override that matches no line of a doc as stale, even when another doc has that line", () => {
    const docs = { "a.md": "## Same\n- [ ] shared\n", "b.md": "## Same\n- [ ] other\n" };
    const result = run(docs, {
      sections: { "a.md#Same": { slice: 1 }, "b.md#Same": { slice: 1 } },
      lines: { "b.md#- [ ] shared": { decision: "D9" } },
    });
    expect(result.lines).toContain("stale line key: b.md#- [ ] shared");
    expect(result.code).toBe(1);
  });

  it("reports an unmapped line with its path and line number", () => {
    const result = run({ "a.md": DOC }, { sections: { "a.md#Alpha": { slice: 1 } } });
    const file = result.docPaths[0];
    expect(result.lines).toEqual([`${file}:12: unmapped: "- [ ] third rule"; add it to the ledger`]);
    expect(result.code).toBe(1);
  });

  it("reports a stale line key", () => {
    const result = run(
      { "a.md": "## A\n- [ ] one\n" },
      { sections: { "a.md#A": { slice: 1 } }, lines: { "a.md#- [ ] gone": { slice: 2 } } },
    );
    expect(result.lines).toEqual(["stale line key: a.md#- [ ] gone"]);
    expect(result.code).toBe(1);
  });

  it("reports a stale section key for a missing heading and for a heading with no rule lines", () => {
    const result = run(
      { "a.md": "## A\n- [ ] one\n## Empty\nprose only\n" },
      { sections: { "a.md#A": { slice: 1 }, "a.md#Missing": { slice: 1 }, "a.md#Empty": { slice: 1 } } },
    );
    expect(result.lines).toEqual(["stale section key: a.md#Missing", "stale section key: a.md#Empty"]);
    expect(result.code).toBe(1);
  });

  it("prints the usage and exits 1 without a ledger and a doc", () => {
    const none: string[] = [];
    expect(runLedger([], { log: (line) => none.push(line) })).toBe(1);
    expect(none).toEqual([USAGE]);
    const one: string[] = [];
    expect(runLedger(["ledger.json"], { log: (line) => one.push(line) })).toBe(1);
    expect(one).toEqual([USAGE]);
  });
});
