import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { tempDir, useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import { VALID_IMPL, savedOk } from "./__fixtures__/persist-bodies.ts";
import { seedOtherPlan } from "./__fixtures__/persist-save-kit.ts";
import { validateImplementation } from "./persist-implementation-validate.ts";
import { IMPLEMENTATION_DIR } from "./persist-implementation.constants.ts";
import { persistImplementation } from "./persist-implementation.ts";

useTempDirs();

function tmpWs(): string {
  return tempDir("persist-impl-");
}

describe("persistImplementation", () => {
  it("never touches .gitignore", () => {
    const ws = tmpWs();
    persistImplementation({ content: VALID_IMPL, workspaceRoot: ws });
    expect(fs.existsSync(path.join(ws, ".gitignore"))).toBe(false);
    const kept = tmpWs();
    fs.writeFileSync(path.join(kept, ".gitignore"), "node_modules\n");
    persistImplementation({ content: VALID_IMPL, workspaceRoot: kept });
    persistImplementation({ content: VALID_IMPL, workspaceRoot: kept });
    expect(fs.readFileSync(path.join(kept, ".gitignore"), "utf8")).toBe("node_modules\n");
  });
});

describe("persistImplementation file", () => {
  it("writes a stamped journal under .tmp/repo/implementations", () => {
    const ws = tmpWs();

    const r = persistImplementation({
      content: VALID_IMPL,
      created: "2026-08-26T14:30:00Z",
      workspaceRoot: ws,
    });

    expect(r.ok).toBe(true);
    expect(r.serial).toBe(1);
    expect(r.plan).toBe("6");
    expect(r.filename).toBe("1-add-tmp-ignore-20260826T143000Z.md");
    expect(r.path).toBe(`${IMPLEMENTATION_DIR}/${r.filename}`);
    expect(path.isAbsolute(savedOk(r).path)).toBe(false);
    const text = fs.readFileSync(path.join(ws, savedOk(r).path), "utf8");
    expect(text).toMatch(/^---\nserial: 1\nplan: 6\nname: add-tmp-ignore\nstatus: in-progress\n/);
    expect(text).toContain('source: "add tmp ignore"');
    expect(text).not.toContain("IMPL_NAME:");
    expect(text).not.toContain("IMPL_PLAN:");
  });
});

describe("persistImplementation defaults", () => {
  it("defaults plan to none", () => {
    const ws = tmpWs();

    const r = persistImplementation({
      content: VALID_IMPL.replace("IMPL_PLAN: 6\n", ""),
      workspaceRoot: ws,
    });

    expect(r.ok).toBe(true);
    expect(r.plan).toBe("none");
    expect(fs.readFileSync(path.join(ws, savedOk(r).path), "utf8")).toMatch(/^---\nserial: 1\nplan: none\n/);
  });

  it("does not collide with plan serials", () => {
    const ws = tmpWs();
    seedOtherPlan(ws);
    const r = persistImplementation({ content: VALID_IMPL, workspaceRoot: ws });
    expect(r.serial).toBe(1);
  });
});

describe("persistImplementation serials", () => {
  it("increments serial and keeps the same stamp", () => {
    const ws = tmpWs();
    const created = "2026-08-26T14:30:00Z";

    const a = persistImplementation({
      content: VALID_IMPL,
      created,
      workspaceRoot: ws,
    });

    const b = persistImplementation({
      content: VALID_IMPL,
      created,
      workspaceRoot: ws,
    });

    expect(a.serial).toBe(1);
    expect(b.serial).toBe(2);
    expect(b.filename).toBe("2-add-tmp-ignore-20260826T143000Z.md");
  });
});

describe("persistImplementation refused plan and headings", () => {
  it("rejects invalid IMPL_PLAN and does not write", () => {
    const ws = tmpWs();

    const r = persistImplementation({
      content: VALID_IMPL.replace("IMPL_PLAN: 6", "IMPL_PLAN: 06"),
      workspaceRoot: ws,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain("plan");
    expect(fs.existsSync(path.join(ws, IMPLEMENTATION_DIR))).toBe(true);
    expect(fs.readdirSync(path.join(ws, IMPLEMENTATION_DIR))).toStrictEqual([]);
  });

  it("rejects extra headings", () => {
    const ws = tmpWs();

    const r = persistImplementation({
      content: `${VALID_IMPL}\n## Steps\n- nope\n`,
      workspaceRoot: ws,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain("extra h2");
  });
});

describe("persistImplementation refused Files", () => {
  it("rejects abs and .tmp Files paths", () => {
    const ws = tmpWs();

    const abs = persistImplementation({
      content: VALID_IMPL.replace("## Files\n(none)", "## Files\n- /etc/passwd"),
      workspaceRoot: ws,
    });

    expect(abs.ok).toBe(false);
    expect(abs.error).toContain("Files abs");

    const tmp = persistImplementation({
      content: VALID_IMPL.replace("## Files\n(none)", "## Files\n- .tmp/repo/x.md"),
      workspaceRoot: ws,
    });

    expect(tmp.ok).toBe(false);
    expect(tmp.error).toContain("Files tmp");
  });
});

function persistText() {
  const ws = tmpWs();

  const r = persistImplementation({
    content: VALID_IMPL,
    created: "2026-08-26T14:30:00Z",
    workspaceRoot: ws,
  });

  return { filename: savedOk(r).filename, text: savedOk(r).content };
}

describe("validateImplementation", () => {
  it("accepts what persistImplementation wrote", () => {
    const good = persistText();
    expect(validateImplementation(good.filename, good.text)).toStrictEqual([]);
  });

  it("accepts a log with [x] leaf lines and Files bullets", () => {
    const good = persistText();

    const text = good.text
      .replace("## Done\n(none)", "## Done\n- ignored .tmp/")
      .replace("## Files\n(none)", "## Files\n- .gitignore")
      .replace("## Log\n(none)", "## Log\n1.1 [x] read gitignore\n1.2 [x] appended .tmp/");

    expect(validateImplementation(good.filename, text)).toStrictEqual([]);
  });

  it("rejects blocked with empty blockers", () => {
    const good = persistText();
    const text = good.text.replace("status: in-progress", "status: blocked");
    expect(validateImplementation(good.filename, text)).toContain("blocked blockers");
  });
});

describe("validateImplementation frontmatter", () => {
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

describe("journal fences", () => {
  it("does not read a fenced heading in the Log as a section", () => {
    const content = VALID_IMPL.replace("## Log\n(none)", "## Log\n1.1 [x] wrote\n\n```md\n## Notes\n```");
    const r = persistImplementation({ content, workspaceRoot: tmpWs() });
    expect(r.error).not.toMatch(/heading order|extra h2/);
  });
});
