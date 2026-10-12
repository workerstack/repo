import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HANDOFF_DIR,
  persistHandoff,
  validateHandoff,
} from "./persist-handoff.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-handoff-"));
  tmpDirs.push(dir);
  return dir;
}

export const VALID_HANDOFF = `HANDOFF_NAME: sync skills to hosts

# sync-skills-to-hosts

## Goal
Ship /handoff as a rulesync skill on every host. Grok copy stays byte-equal to SSOT.

## State
- \`.rulesync/skills/handoff/SKILL.md\` written
- \`scripts/persist-handoff.mjs\` green

## Context
- SSOT: /repo/.rulesync/skills/
- Grok hand copy: /repo/.grok/skills/

## Next
1 [ ] wire generate
1.1 [ ] add -f skills to rulesync:generate
1.2 [ ] add -f skills to rulesync:check

## Watch-outs
- grokcli has no skills target
`;

describe("persistHandoff", () => {
  it("writes a stamped handoff under .tmp/grunt/handoffs", () => {
    const ws = tmpWs();
    const r = persistHandoff({
      workspaceRoot: ws,
      content: VALID_HANDOFF,
      created: "2026-08-27T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.filename).toBe("1-sync-skills-to-hosts-20260827T143000Z.md");
    expect(r.path).toBe(path.join(ws, HANDOFF_DIR, r.filename!));
    const text = fs.readFileSync(r.path!, "utf8");
    expect(text).toMatch(/^---\nserial: 1\nname: sync-skills-to-hosts\nstatus: open\n/);
    expect(text).toContain('source: "sync skills to hosts"');
    expect(text).toContain("# sync-skills-to-hosts");
    expect(text).not.toContain("HANDOFF_NAME:");
  });

  it("does not collide with plan serials", () => {
    const ws = tmpWs();
    fs.mkdirSync(path.join(ws, ".tmp/grunt/plans"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".tmp/grunt/plans/9-other-20260827T143000Z.md"), "x");
    const r = persistHandoff({ workspaceRoot: ws, content: VALID_HANDOFF });
    expect(r.serial).toBe(1);
  });

  it("increments serial and keeps the same stamp", () => {
    const ws = tmpWs();
    const created = "2026-08-27T14:30:00Z";
    const a = persistHandoff({ workspaceRoot: ws, content: VALID_HANDOFF, created });
    const b = persistHandoff({ workspaceRoot: ws, content: VALID_HANDOFF, created });
    expect(a.serial).toBe(1);
    expect(b.serial).toBe(2);
    expect(b.filename).toBe("2-sync-skills-to-hosts-20260827T143000Z.md");
  });

  it("ignores .tmp in gitignore only once", () => {
    const ws = tmpWs();
    fs.writeFileSync(path.join(ws, ".gitignore"), "node_modules\n");
    persistHandoff({ workspaceRoot: ws, content: VALID_HANDOFF });
    persistHandoff({ workspaceRoot: ws, content: VALID_HANDOFF });
    const gi = fs.readFileSync(path.join(ws, ".gitignore"), "utf8");
    expect(gi.match(/^\.tmp\/$/gm)?.length).toBe(1);
  });

  it("rejects a handoff with no Next leaf and does not write", () => {
    const ws = tmpWs();
    const bad = VALID_HANDOFF.replace(/1 \[ \] wire generate\n1\.1[^\n]*\n1\.2[^\n]*\n/, "");
    const r = persistHandoff({ workspaceRoot: ws, content: bad });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no N.M leaf");
    expect(fs.existsSync(path.join(ws, HANDOFF_DIR))).toBe(true);
    expect(fs.readdirSync(path.join(ws, HANDOFF_DIR))).toEqual([]);
  });

  it("rejects extra or reordered headings", () => {
    const ws = tmpWs();
    const r = persistHandoff({
      workspaceRoot: ws,
      content: VALID_HANDOFF + "\n## Steps\n- nope\n",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("extra h2");
  });
});

describe("validateHandoff", () => {
  const good = persistHandoffText();

  function persistHandoffText() {
    const ws = tmpWs();
    const r = persistHandoff({
      workspaceRoot: ws,
      content: VALID_HANDOFF,
      created: "2026-08-27T14:30:00Z",
    });
    return { filename: r.filename!, text: r.content! };
  }

  it("accepts what persistHandoff wrote", () => {
    expect(validateHandoff(good.filename, good.text)).toEqual([]);
  });

  it("rejects an unstamped filename", () => {
    expect(validateHandoff("1-sync-skills-to-hosts.md", good.text)).toContain(
      "filename",
    );
  });

  it("rejects a padded serial", () => {
    const text = good.text.replace("serial: 1", "serial: 01");
    expect(validateHandoff(good.filename, text)).toContain("serial line");
  });

  it("rejects a pre-checked box", () => {
    const text = good.text.replace("1.1 [ ]", "1.1 [x]");
    expect(validateHandoff(good.filename, text)).toContain("fresh [x]");
  });

  it("rejects a bad status", () => {
    const text = good.text.replace("status: open", "status: ready");
    expect(validateHandoff(good.filename, text)).toContain("status");
  });
});
