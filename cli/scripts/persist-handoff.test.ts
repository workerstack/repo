import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/fixtures/temp-dirs.ts";
import { VALID_HANDOFF, savedOk } from "./fixtures/persist-bodies.ts";
import { validateHandoff } from "./persist-handoff-validate.ts";
import { HANDOFF_DIR } from "./persist-handoff.constants.ts";
import { persistHandoff } from "./persist-handoff.ts";

useTempDirs();

function tmpWs(): string {
  return tempDir("persist-handoff-");
}

describe("persistHandoff", () => {
  it("writes a stamped handoff under .tmp/repo/handoffs", () => {
    const ws = tmpWs();
    const r = persistHandoff({
      content: VALID_HANDOFF,
      created: "2026-08-27T14:30:00Z",
      workspaceRoot: ws,
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.filename).toBe("1-sync-skills-to-hosts-20260827T143000Z.md");
    expect(r.path).toBe(`${HANDOFF_DIR}/${r.filename}`);
    expect(path.isAbsolute(savedOk(r).path)).toBe(false);
    const text = fs.readFileSync(path.join(ws, savedOk(r).path), "utf8");
    expect(text).toMatch(/^---\nserial: 1\nname: sync-skills-to-hosts\nstatus: open\n/);
    expect(text).toContain('source: "sync skills to hosts"');
    expect(text).toContain("# sync-skills-to-hosts");
    expect(text).not.toContain("HANDOFF_NAME:");
  });

  it("does not collide with plan serials", () => {
    const ws = tmpWs();
    fs.mkdirSync(path.join(ws, ".tmp/repo/plans"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".tmp/repo/plans/9-other-20260827T143000Z.md"), "x");
    const r = persistHandoff({ content: VALID_HANDOFF, workspaceRoot: ws });
    expect(r.serial).toBe(1);
  });
});

describe("persistHandoff serials and gitignore", () => {
  it("increments serial and keeps the same stamp", () => {
    const ws = tmpWs();
    const created = "2026-08-27T14:30:00Z";
    const a = persistHandoff({ content: VALID_HANDOFF, created, workspaceRoot: ws });
    const b = persistHandoff({ content: VALID_HANDOFF, created, workspaceRoot: ws });
    expect(a.serial).toBe(1);
    expect(b.serial).toBe(2);
    expect(b.filename).toBe("2-sync-skills-to-hosts-20260827T143000Z.md");
  });

  it("never touches .gitignore", () => {
    const ws = tmpWs();
    persistHandoff({ content: VALID_HANDOFF, workspaceRoot: ws });
    expect(fs.existsSync(path.join(ws, ".gitignore"))).toBe(false);
    const kept = tmpWs();
    fs.writeFileSync(path.join(kept, ".gitignore"), "node_modules\n");
    persistHandoff({ content: VALID_HANDOFF, workspaceRoot: kept });
    persistHandoff({ content: VALID_HANDOFF, workspaceRoot: kept });
    expect(fs.readFileSync(path.join(kept, ".gitignore"), "utf8")).toBe("node_modules\n");
  });
});

describe("persistHandoff refusals", () => {
  it("rejects a handoff with no Next leaf and does not write", () => {
    const ws = tmpWs();
    const bad = VALID_HANDOFF.replace(/1 \[ \] wire generate\n1\.1[^\n]*\n1\.2[^\n]*\n/, "");
    const r = persistHandoff({ content: bad, workspaceRoot: ws });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("no N.M leaf");
    expect(fs.existsSync(path.join(ws, HANDOFF_DIR))).toBe(true);
    expect(fs.readdirSync(path.join(ws, HANDOFF_DIR))).toStrictEqual([]);
  });

  it("rejects extra or reordered headings", () => {
    const ws = tmpWs();
    const r = persistHandoff({
      content: `${VALID_HANDOFF}\n## Steps\n- nope\n`,
      workspaceRoot: ws,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("extra h2");
  });
});

function persistHandoffText() {
  const ws = tmpWs();
  const r = persistHandoff({
    content: VALID_HANDOFF,
    created: "2026-08-27T14:30:00Z",
    workspaceRoot: ws,
  });
  return { filename: savedOk(r).filename, text: savedOk(r).content };
}

const good = persistHandoffText();

describe("validateHandoff", () => {
  it("accepts what persistHandoff wrote", () => {
    expect(validateHandoff(good.filename, good.text)).toStrictEqual([]);
  });

  it("rejects an unstamped filename", () => {
    expect(validateHandoff("1-sync-skills-to-hosts.md", good.text)).toContain("filename");
  });

  it("rejects a padded serial", () => {
    const text = good.text.replace("serial: 1", "serial: 01");
    expect(validateHandoff(good.filename, text)).toContain("serial line");
  });
});

describe("validateHandoff content", () => {
  it("rejects a pre-checked box", () => {
    const text = good.text.replace("1.1 [ ]", "1.1 [x]");
    expect(validateHandoff(good.filename, text)).toContain("fresh [x]");
  });

  it("rejects a bad status", () => {
    const text = good.text.replace("status: open", "status: ready");
    expect(validateHandoff(good.filename, text)).toContain("status");
  });
});

describe("handoff fences", () => {
  it("saves a handoff whose Context shows a fenced heading", () => {
    const content = VALID_HANDOFF.replace(
      "- Claude link: /repo/.claude/skills/\n",
      "- Claude link: /repo/.claude/skills/\n\n```md\n## Next\n```\n",
    );
    const r = persistHandoff({ content, workspaceRoot: tmpWs() });
    expect(r.ok, r.error).toBe(true);
  });
});
