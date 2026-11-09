import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VALID_HANDOFF } from "./fixtures/persist-bodies.ts";
import { HANDOFF_DIR, persistHandoff } from "./persist-handoff.ts";

const tmpDirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpWs() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "persist-handoff-s-")));
  tmpDirs.push(dir);
  return dir;
}

const CREATED = "2026-08-27T14:30:00Z";
const STAMP = "20260827T143000Z";
const withoutName = VALID_HANDOFF.replace("HANDOFF_NAME: sync skills to hosts\n\n", "");

describe("persistHandoff naming", () => {
  it("names the file after the first H1 when there is no HANDOFF_NAME", () => {
    const r = persistHandoff({ workspaceRoot: tmpWs(), content: withoutName, created: CREATED });
    expect(r.filename).toBe(`1-sync-skills-to-hosts-${STAMP}.md`);
    expect(r.content).toContain('source: "sync-skills-to-hosts"');
  });

  it("reads the H1 past a leading frontmatter block", () => {
    const r = persistHandoff({
      workspaceRoot: tmpWs(),
      content: `---\nold: 1\n---\n${withoutName}`,
      created: CREATED,
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.slug).toBe("sync-skills-to-hosts");
  });

  it("falls back to the Goal text for the source when nothing names the handoff", () => {
    const content = withoutName.replace("# sync-skills-to-hosts\n\n", "");
    const r = persistHandoff({ workspaceRoot: tmpWs(), content, created: CREATED });
    expect(r.ok, r.error).toBe(true);
    expect(r.slug).toBe("unnamed");
    expect(r.content).toContain(
      'source: "Ship /handoff as a skill on every host. Claude links resolve to the source."',
    );
  });

  it("refuses a body with no sections", () => {
    const r = persistHandoff({ workspaceRoot: tmpWs(), content: "just words\n" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("heading order");
  });
});

describe("persistHandoff source and stamp", () => {
  it("keeps a source the caller gives, cut to 120 characters", () => {
    const r = persistHandoff({ workspaceRoot: tmpWs(), content: VALID_HANDOFF, source: "s".repeat(200) });
    expect(r.content).toContain(`source: "${"s".repeat(120)}"`);
  });

  it("stamps now when created is not a UTC datetime", () => {
    const r = persistHandoff({ workspaceRoot: tmpWs(), content: VALID_HANDOFF, created: "2026-08-27" });
    expect(r.filename).toMatch(/^1-sync-skills-to-hosts-\d{8}T\d{6}Z\.md$/);
    expect(r.filename).not.toContain("20260827T");
  });
});

describe("persistHandoff refusals", () => {
  it("refuses a body with an open fence before it creates the directory", () => {
    const ws = tmpWs();
    const r = persistHandoff({ workspaceRoot: ws, content: `${VALID_HANDOFF}\n\`\`\`md\n` });
    expect(r.ok).toBe(false);
    expect(r.errors?.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(ws, ".tmp"))).toBe(false);
  });
});

describe("persistHandoff serial limits", () => {
  it("reports a serial collision when the next name is already taken", () => {
    const ws = tmpWs();
    const dir = path.join(ws, HANDOFF_DIR);
    fs.mkdirSync(dir, { recursive: true });
    // A serial past 2**53 cannot count up: the next serial is the one already on disk.
    const taken = `100000000000000000000-sync-skills-to-hosts-${STAMP}.md`;
    fs.writeFileSync(path.join(dir, taken), "x");
    const r = persistHandoff({ workspaceRoot: ws, content: VALID_HANDOFF, created: CREATED });
    expect(r).toEqual({ ok: false, error: "serial collision" });
    expect(fs.readdirSync(dir)).toEqual([taken]);
  });

  it("refuses a serial that no longer prints as digits", () => {
    const ws = tmpWs();
    const dir = path.join(ws, HANDOFF_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${"1".padEnd(22, "0")}-old-${STAMP}.md`), "x");
    const r = persistHandoff({ workspaceRoot: ws, content: VALID_HANDOFF, created: CREATED });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("filename");
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  it("refuses an empty body with the reasons it fails", () => {
    const r = persistHandoff({ workspaceRoot: tmpWs(), content: "" });
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining(["goal", "heading order", "State empty"]));
  });
});

describe("persistHandoff root", () => {
  it("saves under the repo root of the working directory when no workspace is given", () => {
    const root = tmpWs();
    execFileSync("git", ["init", "-q"], { cwd: root });
    vi.stubEnv("GROK_WORKSPACE_ROOT", "");
    vi.stubEnv("CLAUDE_PROJECT_DIR", "");
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const saved = persistHandoff({ content: VALID_HANDOFF });
    expect(saved.ok, saved.error).toBe(true);
    expect(fs.readdirSync(path.join(root, HANDOFF_DIR))).toEqual([saved.filename]);
    expect(persistHandoff().ok).toBe(false);
  });
});
