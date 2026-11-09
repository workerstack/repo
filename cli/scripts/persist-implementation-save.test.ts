import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VALID_IMPL } from "./fixtures/persist-bodies.ts";
import { IMPLEMENTATION_DIR, persistImplementation } from "./persist-implementation.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpWs() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "persist-impl-s-")));
  tmpDirs.push(dir);
  return dir;
}

const CREATED = "2026-08-26T14:30:00Z";
const STAMP = "20260826T143000Z";
const withoutName = VALID_IMPL.replace("IMPL_NAME: add tmp ignore\n", "");

describe("persistImplementation naming", () => {
  it("names the file after the first H1 when there is no IMPL_NAME", () => {
    const r = persistImplementation({ workspaceRoot: tmpWs(), content: withoutName, created: CREATED });
    expect(r.filename).toBe(`1-add-tmp-ignore-${STAMP}.md`);
    expect(r.content).toContain('source: "add-tmp-ignore"');
  });

  it("reads the H1 past a leading frontmatter block", () => {
    const r = persistImplementation({
      workspaceRoot: tmpWs(),
      content: `---\nold: 1\n---\n${withoutName}`,
      created: CREATED,
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.slug).toBe("add-tmp-ignore");
  });

  it("falls back to the Done text for the source when nothing names the journal", () => {
    const content = withoutName
      .replace("# add-tmp-ignore\n\n", "")
      .replace("## Done\n(none)", "## Done\n- wrote\n- the ignore");
    const r = persistImplementation({ workspaceRoot: tmpWs(), content, created: CREATED });
    expect(r.ok, r.error).toBe(true);
    expect(r.slug).toBe("unnamed");
    expect(r.content).toContain('source: "- wrote - the ignore"');
  });

  it("refuses a body with no sections", () => {
    const r = persistImplementation({ workspaceRoot: tmpWs(), content: "just words\n" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("heading order");
  });
});

describe("persistImplementation source and stamp", () => {
  it("keeps a source the caller gives, cut to 120 characters", () => {
    const r = persistImplementation({ workspaceRoot: tmpWs(), content: VALID_IMPL, source: "s".repeat(200) });
    expect(r.content).toContain(`source: "${"s".repeat(120)}"`);
  });

  it("stamps now when created is not a UTC datetime", () => {
    const r = persistImplementation({ workspaceRoot: tmpWs(), content: VALID_IMPL, created: "2026-08-26" });
    expect(r.filename).toMatch(/^1-add-tmp-ignore-\d{8}T\d{6}Z\.md$/);
    expect(r.filename).not.toContain("20260826T");
  });
});

describe("persistImplementation refusals", () => {
  it("refuses a body with an open fence before it creates the directory", () => {
    const ws = tmpWs();
    const r = persistImplementation({ workspaceRoot: ws, content: `${VALID_IMPL}\n\`\`\`md\n` });
    expect(r.ok).toBe(false);
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(ws, ".tmp"))).toBe(false);
  });
});

describe("persistImplementation serial limits", () => {
  it("reports a serial collision when the next name is already taken", () => {
    const ws = tmpWs();
    const dir = path.join(ws, IMPLEMENTATION_DIR);
    fs.mkdirSync(dir, { recursive: true });
    // A serial past 2**53 cannot count up: the next serial is the one already on disk.
    const taken = `100000000000000000000-add-tmp-ignore-${STAMP}.md`;
    fs.writeFileSync(path.join(dir, taken), "x");
    const r = persistImplementation({ workspaceRoot: ws, content: VALID_IMPL, created: CREATED });
    expect(r).toEqual({ ok: false, error: "serial collision" });
    expect(fs.readdirSync(dir)).toEqual([taken]);
  });

  it("refuses a serial that no longer prints as digits", () => {
    const ws = tmpWs();
    const dir = path.join(ws, IMPLEMENTATION_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${"1".padEnd(22, "0")}-old-${STAMP}.md`), "x");
    const r = persistImplementation({ workspaceRoot: ws, content: VALID_IMPL, created: CREATED });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("filename");
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });
});

describe("persistImplementation root", () => {
  it("saves under the repo root of the working directory when no workspace is given", () => {
    const root = tmpWs();
    execFileSync("git", ["init", "-q"], { cwd: root });
    vi.stubEnv("GROK_WORKSPACE_ROOT", "");
    vi.stubEnv("CLAUDE_PROJECT_DIR", "");
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const saved = persistImplementation({ content: VALID_IMPL });
    expect(saved.ok, saved.error).toBe(true);
    expect(fs.readdirSync(path.join(root, IMPLEMENTATION_DIR))).toEqual([saved.filename]);
    expect(persistImplementation().ok).toBe(false);
  });
});
