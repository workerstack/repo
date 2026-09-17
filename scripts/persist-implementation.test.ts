import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  IMPLEMENTATION_DIR,
  persistImplementation,
  validateImplementation,
} from "./persist-implementation.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmpWs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "persist-impl-"));
  tmpDirs.push(dir);
  return dir;
}

export const VALID_IMPL = `IMPL_NAME: add tmp ignore
IMPL_PLAN: 6

# add-tmp-ignore

## Done
(none)

## Issue
(none)

## Files
(none)

## Log
(none)

## Blockers
(none)

## Notes
(none)
`;

describe("persistImplementation", () => {
  it("writes a stamped journal under .tmp/grunt/implementations", () => {
    const ws = tmpWs();
    const r = persistImplementation({
      workspaceRoot: ws,
      content: VALID_IMPL,
      created: "2026-08-26T14:30:00Z",
    });
    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.plan).toBe("6");
    expect(r.filename).toBe("1-add-tmp-ignore-20260826T143000Z.md");
    expect(r.path).toBe(path.join(ws, IMPLEMENTATION_DIR, r.filename!));
    const text = fs.readFileSync(r.path!, "utf8");
    expect(text).toMatch(
      /^---\nserial: 1\nplan: 6\nname: add-tmp-ignore\nstatus: in-progress\n/,
    );
    expect(text).toContain('source: "add tmp ignore"');
    expect(text).not.toContain("IMPL_NAME:");
    expect(text).not.toContain("IMPL_PLAN:");
  });

  it("defaults plan to none", () => {
    const ws = tmpWs();
    const r = persistImplementation({
      workspaceRoot: ws,
      content: VALID_IMPL.replace("IMPL_PLAN: 6\n", ""),
    });
    expect(r.ok).toBe(true);
    expect(r.plan).toBe("none");
    expect(fs.readFileSync(r.path!, "utf8")).toMatch(/^---\nserial: 1\nplan: none\n/);
  });

  it("does not collide with plan serials", () => {
    const ws = tmpWs();
    fs.mkdirSync(path.join(ws, ".tmp/grunt/plans"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".tmp/grunt/plans/9-other-20260826T143000Z.md"), "x");
    const r = persistImplementation({ workspaceRoot: ws, content: VALID_IMPL });
    expect(r.serial).toBe(1);
  });

  it("increments serial and keeps the same stamp", () => {
    const ws = tmpWs();
    const created = "2026-08-26T14:30:00Z";
    const a = persistImplementation({
      workspaceRoot: ws,
      content: VALID_IMPL,
      created,
    });
    const b = persistImplementation({
      workspaceRoot: ws,
      content: VALID_IMPL,
      created,
    });
    expect(a.serial).toBe(1);
    expect(b.serial).toBe(2);
    expect(b.filename).toBe("2-add-tmp-ignore-20260826T143000Z.md");
  });

  it("rejects invalid IMPL_PLAN and does not write", () => {
    const ws = tmpWs();
    const r = persistImplementation({
      workspaceRoot: ws,
      content: VALID_IMPL.replace("IMPL_PLAN: 6", "IMPL_PLAN: 06"),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("plan");
    expect(fs.existsSync(path.join(ws, IMPLEMENTATION_DIR))).toBe(true);
    expect(fs.readdirSync(path.join(ws, IMPLEMENTATION_DIR))).toEqual([]);
  });

  it("rejects extra headings", () => {
    const ws = tmpWs();
    const r = persistImplementation({
      workspaceRoot: ws,
      content: VALID_IMPL + "\n## Steps\n- nope\n",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("extra h2");
  });

  it("rejects abs and .tmp Files paths", () => {
    const ws = tmpWs();
    const abs = persistImplementation({
      workspaceRoot: ws,
      content: VALID_IMPL.replace("## Files\n(none)", "## Files\n- /etc/passwd"),
    });
    expect(abs.ok).toBe(false);
    expect(abs.error).toContain("Files abs");
    const tmp = persistImplementation({
      workspaceRoot: ws,
      content: VALID_IMPL.replace("## Files\n(none)", "## Files\n- .tmp/grunt/x.md"),
    });
    expect(tmp.ok).toBe(false);
    expect(tmp.error).toContain("Files tmp");
  });
});

describe("validateImplementation", () => {
  function persistText() {
    const ws = tmpWs();
    const r = persistImplementation({
      workspaceRoot: ws,
      content: VALID_IMPL,
      created: "2026-08-26T14:30:00Z",
    });
    return { filename: r.filename!, text: r.content! };
  }

  it("accepts what persistImplementation wrote", () => {
    const good = persistText();
    expect(validateImplementation(good.filename, good.text)).toEqual([]);
  });

  it("accepts a log with [x] leaf lines and Files bullets", () => {
    const good = persistText();
    const text = good.text
      .replace("## Done\n(none)", "## Done\n- ignored .tmp/")
      .replace("## Files\n(none)", "## Files\n- .gitignore")
      .replace("## Log\n(none)", "## Log\n1.1 [x] read gitignore\n1.2 [x] appended .tmp/");
    expect(validateImplementation(good.filename, text)).toEqual([]);
  });

  it("rejects blocked with empty blockers", () => {
    const good = persistText();
    const text = good.text.replace("status: in-progress", "status: blocked");
    expect(validateImplementation(good.filename, text)).toContain("blocked blockers");
  });

  it("rejects a padded serial", () => {
    const good = persistText();
    const text = good.text.replace("serial: 1", "serial: 01");
    expect(validateImplementation(good.filename, text)).toContain("serial line");
  });

  it("rejects a bad status", () => {
    const good = persistText();
    const text = good.text.replace("status: in-progress", "status: ready");
    expect(validateImplementation(good.filename, text)).toContain("status");
  });
});
