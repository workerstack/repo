import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aliasOf } from "../dev/test-paths";

const emitMaps = vi.hoisted(() => vi.fn());
const actualEmitMaps = vi.hoisted(() => ({ fn: null as null | ((...args: unknown[]) => unknown) }));

vi.mock("../.rulesync/scripts/emit-maps.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../.rulesync/scripts/emit-maps.mjs")>();
  actualEmitMaps.fn = actual.emitMaps;
  emitMaps.mockImplementation((...args: unknown[]) =>
    actual.emitMaps(...(args as Parameters<typeof actual.emitMaps>)),
  );
  return { ...actual, emitMaps };
});
import {
  MAX_GUARDED_MARKDOWN_BYTES,
  PRODUCT_SCRIPTS,
  SCRIPTS_REL,
  composeGuardedMarkdown,
  copyTree,
  destAlreadyInited,
  extractManagedBody,
  extractUserMarkdown,
  GUARDED_ROOT_FILES,
  SENTINEL_BEGIN,
  SENTINEL_END,
  guardedMarkdownDrift,
  healGuardedRootFile,
  init,
  pruneRetired,
  RESERVED_SKILLS,
  LAUNCH_SCRIPTS,
  E2E_VITEST_CONFIGS,
  extraH2Sections,
  mergeReferenceMarkdown,
  snapshotReferenceDocs,
  remergeReferenceDocs,
  seedPipelineConfig,
  PIPELINE_CONFIG_REL,
  mergeClaudeSettings,
  mergeGitignore,
  mergeGuardedContent,
  mergeGuardedMarkdown,
  GENERATED_MAP_FILES,
  PACKAGE_NAME,
  mergePackageJson,
  placeDevDependency,
  remergeGuardedRoots,
  samePath,
  shouldAutoSkipGlobals,
  snapshotGuardedRoots,
  toScriptName,
  withGuardedCheckInteriors,
  writeMergedGuardedFile,
} from "./init.mjs";
import { runGuardedRoots } from "../.rulesync/scripts/guarded-roots.mjs";
import { COMMANDS as PIPELINE_COMMANDS } from "../.rulesync/scripts/pipeline.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  emitMaps.mockReset();
  emitMaps.mockImplementation((...args: unknown[]) =>
    (actualEmitMaps.fn as (...a: unknown[]) => unknown)(...args),
  );
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

const COPY_DIRS = [".rulesync", ".grok", ".codex", ".claude", ".agents"];
const GUARDED_MD_FILES = ["AGENTS.md", "CLAUDE.md"];
const PRODUCT_FILES = PRODUCT_SCRIPTS.filter((name) => name !== "scrub-text");
const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const SRC_CLAUDE_SETTINGS = {
  permissions: {
    deny: ["Agent(Explore)", "Agent(Plan)", "mcp__*"],
  },
  hooks: {
    SessionStart: [
      {
        hooks: [
          {
            type: "command",
            command: 'node "${ROOT}/.rulesync/scripts/session-map.mjs"',
            timeout: 5,
          },
        ],
      },
    ],
    PreToolUse: [
      {
        matcher: "spawn",
        hooks: [
          {
            type: "command",
            command: 'node "${ROOT}/.rulesync/scripts/scrub-spawn-prompt.mjs"',
          },
        ],
      },
      {
        matcher: "fat",
        hooks: [
          {
            type: "command",
            command: 'node "${ROOT}/.rulesync/scripts/gate-fat-tools.mjs"',
          },
        ],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: 'node "${ROOT}/.grok/hooks/orchestrate-parent.js"',
          },
        ],
      },
    ],
  },
  enableAllProjectMcpServers: false,
  enabledMcpjsonServers: [],
};

function stubPkgRoot(pkg: Record<string, unknown> = {
  name: "fixture-pkg",
  scripts: {
    test: "skip-me",
    zeta: "z",
    alpha: "a",
    "rulesync:generate": "gen",
  },
  dependencies: {
    "smol-toml": "^1.8.0",
  },
  devDependencies: {
    rulesync: "latest",
    zzz: "1",
  },
}) {
  const root = tmp("repo-pkg-");
  for (const d of COPY_DIRS) {
    fs.mkdirSync(path.join(root, d));
    fs.writeFileSync(path.join(root, d, "marker"), d);
  }
  fs.writeFileSync(
    path.join(root, ".claude", "settings.json"),
    `${JSON.stringify(SRC_CLAUDE_SETTINGS, null, 2)}\n`,
  );
  for (const f of GUARDED_MD_FILES) {
    fs.writeFileSync(path.join(root, f), `${f} content`);
  }
  fs.mkdirSync(path.join(root, ".rulesync", "scripts"));
  for (const name of PRODUCT_FILES) {
    fs.writeFileSync(path.join(root, ".rulesync", "scripts", name), name);
  }
  fs.mkdirSync(path.join(root, ".rulesync", "scripts", "scrub-text"));
  fs.writeFileSync(path.join(root, ".rulesync", "scripts", "scrub-text", "inside"), "dir");
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  return root;
}

describe("samePath", () => {
  it("try: realpath equal vs unequal", () => {
    const a = tmp("same-a-");
    const b = tmp("same-b-");
    expect(samePath(a, a)).toBe(true);
    expect(samePath(a, b)).toBe(false);
    expect(samePath(aliasOf(a), a)).toBe(true);
    fs.rmSync(`${a}-alias`, { force: true });
  });

  it("catch: missing paths fall back to resolve", () => {
    const missing = path.join(os.tmpdir(), `repo-missing-${process.pid}-nope`);
    expect(samePath(missing, missing)).toBe(true);
    expect(samePath(missing, `${missing}-other`)).toBe(false);
  });
});

const GI = ".tmp/\n.worktrees/\n";

describe("mergeGitignore", () => {
  it("creates .tmp/ and .worktrees/ when missing", () => {
    const dest = tmp("gi-miss-");
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(GI);
  });

  it("adds only .worktrees/ when .tmp/ is present", () => {
    const dest = tmp("gi-slash-");
    fs.writeFileSync(path.join(dest, ".gitignore"), "foo\n.tmp/\nbar\n");
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(
      "foo\n.tmp/\nbar\n.worktrees/\n",
    );
  });

  it("adds only .worktrees/ when .tmp is present", () => {
    const dest = tmp("gi-bare-");
    fs.writeFileSync(path.join(dest, ".gitignore"), ".tmp\n");
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(".tmp\n.worktrees/\n");
  });

  it("noop when both are present in any form", () => {
    for (const wt of [".worktrees", ".worktrees/", "/.worktrees/"]) {
      const dest = tmp("gi-both-");
      const text = `foo\n.tmp/\n${wt}\nbar\n`;
      fs.writeFileSync(path.join(dest, ".gitignore"), text);
      mergeGitignore(dest);
      expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8"), wt).toBe(text);
    }
  });

  it("appends after trailing newline", () => {
    const dest = tmp("gi-nl-");
    fs.writeFileSync(path.join(dest, ".gitignore"), "node_modules/\n");
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(
      `node_modules/\n${GI}`,
    );
  });

  it("appends with inserted newline when file lacks one", () => {
    const dest = tmp("gi-nonl-");
    fs.writeFileSync(path.join(dest, ".gitignore"), "node_modules/");
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(
      `node_modules/\n${GI}`,
    );
  });

  it("appends to empty existing file", () => {
    const dest = tmp("gi-empty-");
    fs.writeFileSync(path.join(dest, ".gitignore"), "");
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(GI);
  });
});

describe("mergeGuardedMarkdown", () => {
  it("self: dest === src is a no-op", () => {
    const dir = tmp("md-self-");
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "raw content");
    mergeGuardedMarkdown(dir, dir, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toBe("raw content");
  });

  it("dest absent: writes package copy wrapped in sentinels", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-absent-");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n",
    );
  });

  it("dest exists without sentinel: prepends wrapped repo, keeps full old body", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-nosentinel-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "hand-written consumer doc\n");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n\nhand-written consumer doc\n",
    );
    expect(fs.existsSync(path.join(dest, "CLAUDE.repo.md"))).toBe(false);
  });

  it("alreadyInited unmarked still prepends; skip is not safe", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-inited-nosent-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "hand-written consumer doc\n");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md", { alreadyInited: true });
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n\nhand-written consumer doc\n",
    );
    expect(fs.existsSync(path.join(dest, "CLAUDE.repo.md"))).toBe(false);
  });

  it("empty dest file is treated as missing", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-empty-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n",
    );
  });

  it("dest exists with sentinel: repo block at top, outside kept at bottom", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-sentinel-");
    fs.writeFileSync(
      path.join(dest, "CLAUDE.md"),
      "before\n<!-- repo:begin -->\nold generated stuff\n<!-- repo:end -->\nafter\n",
    );
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n\nbefore\nafter\n",
    );
    expect(fs.existsSync(path.join(dest, "CLAUDE.repo.md"))).toBe(false);
  });

  it("collapses duplicate sentinel pairs to one top block", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-dup-sent-");
    fs.writeFileSync(
      path.join(dest, "CLAUDE.md"),
      "<!-- repo:begin -->\nold-a\n<!-- repo:end -->\nkeep-a\n<!-- repo:begin -->\nold-b\n<!-- repo:end -->\nkeep-b\n",
    );
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    const out = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(out).toBe(
      "<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n\nkeep-a\nkeep-b\n",
    );
    expect(out.split("<!-- repo:begin -->")).toHaveLength(2);
  });

  it("second merge is idempotent and does not double-prepend", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-idem-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "hand-written consumer doc\n");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n\nhand-written consumer doc\n",
    );
  });

  it("already-guarded package src stays begin=1 end=1", () => {
    const pkgRoot = stubPkgRoot();
    fs.writeFileSync(
      path.join(pkgRoot, "CLAUDE.md"),
      "<!-- repo:begin -->\nCLAUDE.md content\n<!-- repo:end -->\n",
    );
    const dest = tmp("md-wrapped-src-");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    const out = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(out).toBe("<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n");
    expect(out.split("<!-- repo:begin -->")).toHaveLength(2);
    expect(out.split("<!-- repo:end -->")).toHaveLength(2);
  });

  it("merge heals dest with trailing orphan repo:end", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-orphan-end-");
    fs.writeFileSync(
      path.join(dest, "CLAUDE.md"),
      "<!-- repo:begin -->\nold\n<!-- repo:end -->\n<!-- repo:end -->\n",
    );
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    const out = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(out).toBe("<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n");
    expect(out.split("<!-- repo:end -->")).toHaveLength(2);
  });

  it("dest stacked researcher shape heals to exactly one pair", () => {
    const pkgRoot = stubPkgRoot();
    fs.writeFileSync(
      path.join(pkgRoot, "CLAUDE.md"),
      "<!-- repo:begin -->\nCLAUDE.md content\n<!-- repo:end -->\n",
    );
    const dest = tmp("md-stacked-");
    fs.writeFileSync(
      path.join(dest, "CLAUDE.md"),
      "<!-- repo:begin -->\n<!-- repo:begin -->\nBODY\n<!-- repo:end -->\n<!-- repo:end -->\n",
    );
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    const out = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(out).toBe("<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n");
    expect(out.split("<!-- repo:begin -->")).toHaveLength(2);
    expect(out.split("<!-- repo:end -->")).toHaveLength(2);
  });

  it("dest stacked keeps user prefix/suffix outside the pair", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-stacked-user-");
    fs.writeFileSync(
      path.join(dest, "CLAUDE.md"),
      "prefix\n<!-- repo:begin -->\n<!-- repo:begin -->\nBODY\n<!-- repo:end -->\n<!-- repo:end -->\nsuffix\n",
    );
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    const out = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(out).toBe(
      "<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n\nprefix\nsuffix\n",
    );
    expect(out.split("<!-- repo:begin -->")).toHaveLength(2);
    expect(out.split("<!-- repo:end -->")).toHaveLength(2);
  });

  it("does not fuzzy-dedupe unmarked protocol-looking user text", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-proto-");
    const user = "Voice: `.rulesync/reference/output.md` — cite once.\nspawn scout\n";
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), user);
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      `<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n\n${user}`,
    );
  });

  it("preserves CRLF from dest", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-crlf-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "user line\r\n");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- repo:begin -->\r\n\r\nCLAUDE.md content\r\n\r\n<!-- repo:end -->\r\n\r\nuser line\r\n",
    );
  });

  it("unmarked dest equal to repo body wraps without duplicating", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-equal-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "CLAUDE.md content\n");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n",
    );
  });

  it("binary dest is left untouched", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-bin-");
    const raw = Buffer.from([0x68, 0x69, 0x00, 0xff]);
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), raw);
    expect(mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md")).toBe("aborted-unsafe");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"))).toEqual(raw);
  });

  it("leaves nested AGENTS.md alone", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-nested-");
    fs.mkdirSync(path.join(dest, "pkg"), { recursive: true });
    fs.writeFileSync(path.join(dest, "pkg", "AGENTS.md"), "nested user\n");
    mergeGuardedMarkdown(dest, pkgRoot, "AGENTS.md");
    expect(fs.readFileSync(path.join(dest, "pkg", "AGENTS.md"), "utf8")).toBe("nested user\n");
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nAGENTS.md content\n\n<!-- repo:end -->\n",
    );
  });
});

describe("snapshot/remerge guarded roots", () => {
  it("remerge after clobber keeps user bottom and refreshes repo interior", () => {
    const dest = tmp("snap-clobber-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- repo:begin -->\nold\n<!-- repo:end -->\nconsumer agents\n",
    );
    fs.writeFileSync(path.join(dest, "GEMINI.md"), "user gemini\n");
    const snap = snapshotGuardedRoots(dest);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "generated agents\n");
    fs.writeFileSync(path.join(dest, "GEMINI.md"), "@AGENTS.md\n");
    remergeGuardedRoots(dest, snap);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\ngenerated agents\n\n<!-- repo:end -->\n\nconsumer agents\n",
    );
    expect(fs.readFileSync(path.join(dest, "GEMINI.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\n@AGENTS.md\n\n<!-- repo:end -->\n\nuser gemini\n",
    );
  });

  it("remerge after wrapped-src merge+generate does not reattach orphan end", () => {
    const pkgRoot = stubPkgRoot();
    fs.writeFileSync(
      path.join(pkgRoot, "AGENTS.md"),
      "<!-- repo:begin -->\nAGENTS.md content\n<!-- repo:end -->\n",
    );
    const dest = tmp("snap-wrap-src-");
    mergeGuardedMarkdown(dest, pkgRoot, "AGENTS.md");
    const snap = snapshotGuardedRoots(dest);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "generated agents\n");
    remergeGuardedRoots(dest, snap);
    const out = fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8");
    expect(out).toBe("<!-- repo:begin -->\n\ngenerated agents\n\n<!-- repo:end -->\n");
    expect(out.split("<!-- repo:begin -->")).toHaveLength(2);
    expect(out.split("<!-- repo:end -->")).toHaveLength(2);
  });

  it("withGuardedCheckInteriors is restored even if check throws", () => {
    const dest = tmp("check-int-");
    const live =
      "<!-- repo:begin -->\nrepo body\n<!-- repo:end -->\nuser bottom\n";
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), live);
    expect(() =>
      withGuardedCheckInteriors(dest, () => {
        expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe("repo body\n");
        throw new Error("check failed");
      }),
    ).toThrow("check failed");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(live);
  });

  it("compose/extract/drift/write helpers cover remaining branches", () => {
    expect(
      extractUserMarkdown(
        "<!-- repo:begin -->\nbody\n<!-- repo:end -->\n<!-- repo:end -->\n",
      ),
    ).toBe("");
    expect(
      extractUserMarkdown(
        "<!-- repo:begin -->\nbody\n<!-- repo:end -->\nkeep\n<!-- repo:end -->\n",
      ),
    ).toBe("keep\n");
    expect(
      composeGuardedMarkdown(
        "<!-- repo:begin -->\nbody\n<!-- repo:end -->\n",
        "<!-- repo:end -->\n",
      ),
    ).toBe("<!-- repo:begin -->\n\nbody\n\n<!-- repo:end -->\n");
    expect(composeGuardedMarkdown("body", null)).toBe(
      "<!-- repo:begin -->\n\nbody\n\n<!-- repo:end -->\n",
    );
    expect(composeGuardedMarkdown("body", "\n\n")).toBe(
      "<!-- repo:begin -->\n\nbody\n\n<!-- repo:end -->\n",
    );
    expect(extractManagedBody("no markers")).toBeNull();
    expect(
      extractManagedBody(
        "<!-- repo:begin -->\na\n<!-- repo:end -->\n<!-- repo:begin -->\nb\n<!-- repo:end -->\n",
      ),
    ).toBe("a\nb");
    expect(mergeGuardedContent(null, "g")).toBe(
      "<!-- repo:begin -->\n\ng\n\n<!-- repo:end -->\n",
    );
    expect(mergeGuardedContent("", "a\r\nb")).toBe(
      "<!-- repo:begin -->\r\n\r\na\r\nb\r\n\r\n<!-- repo:end -->\r\n",
    );
    expect(composeGuardedMarkdown("b", "\r\n")).toBe(
      "<!-- repo:begin -->\n\nb\n\n<!-- repo:end -->\n",
    );
    expect(mergeGuardedContent("keep\n", "g\r\n")).toBe(
      "<!-- repo:begin -->\n\ng\n\n<!-- repo:end -->\n\nkeep\n",
    );
    expect(mergeGuardedContent("<!-- repo:begin --> only", "g")).toBe(
      "<!-- repo:begin -->\n\ng\n\n<!-- repo:end -->\n",
    );
    const dest = tmp("md-helpers-");
    const missing = path.join(dest, "nope.md");
    expect(guardedMarkdownDrift(missing, "g")).toBe(true);
    writeMergedGuardedFile(missing, "g");
    expect(fs.readFileSync(missing, "utf8")).toBe(
      "<!-- repo:begin -->\n\ng\n\n<!-- repo:end -->\n",
    );
    expect(guardedMarkdownDrift(missing, "g")).toBe(false);
    expect(guardedMarkdownDrift(missing, "other")).toBe(true);
    fs.writeFileSync(missing, "plain\n");
    expect(guardedMarkdownDrift(missing, "plain\n")).toBe(false);
    expect(guardedMarkdownDrift(missing, "x")).toBe(true);
    const bin = path.join(dest, "bin.md");
    fs.writeFileSync(bin, Buffer.from([0]));
    expect(guardedMarkdownDrift(bin, "g")).toBe(true);
    const huge = path.join(dest, "huge.md");
    fs.writeFileSync(huge, Buffer.alloc(MAX_GUARDED_MARKDOWN_BYTES + 1, 65));
    expect(writeMergedGuardedFile(huge, "g")).toBe("aborted-unsafe");
  });

  it("formatter-padded sentinels are a fixed point and do not drift", () => {
    const padded = "<!-- repo:begin -->\n\n@AGENTS.md\n\n<!-- repo:end -->\n";
    const withUser = "<!-- repo:begin -->\n\nbody\n\n<!-- repo:end -->\n\n# Mine\n";
    expect(extractManagedBody(padded)).toBe("@AGENTS.md");
    expect(mergeGuardedContent(padded, "@AGENTS.md\n")).toBe(padded);
    expect(mergeGuardedContent(withUser, "body")).toBe(withUser);
    expect(extractUserMarkdown(withUser)).toBe("\n# Mine\n");
    expect(
      mergeGuardedContent("<!-- repo:begin -->\n@AGENTS.md\n<!-- repo:end -->\nuser\n", "@AGENTS.md"),
    ).toBe("<!-- repo:begin -->\n\n@AGENTS.md\n\n<!-- repo:end -->\n\nuser\n");
    const file = path.join(tmp("md-padded-"), "GEMINI.md");
    fs.writeFileSync(file, padded);
    expect(guardedMarkdownDrift(file, "@AGENTS.md")).toBe(false);
  });

  it("unclosed begin unwraps interior; inline orphan end is stripped", () => {
    expect(extractManagedBody("<!-- repo:begin -->\nhello")).toBe("hello");
    const composed = composeGuardedMarkdown("<!-- repo:begin -->\nhello", "");
    expect(composed).toBe("<!-- repo:begin -->\n\nhello\n\n<!-- repo:end -->\n");
    expect(composed.split(SENTINEL_BEGIN)).toHaveLength(2);
    expect(composed.split(SENTINEL_END)).toHaveLength(2);
    expect(composed).not.toContain(`${SENTINEL_BEGIN}\n${SENTINEL_BEGIN}`);
    expect(mergeGuardedContent("note\n<!-- repo:begin -->\nstale", "new")).toBe(
      "<!-- repo:begin -->\n\nnew\n\n<!-- repo:end -->\n\nnote\n",
    );
    expect(extractUserMarkdown("keep <!-- repo:end --> me")).not.toContain(SENTINEL_END);
    expect(extractUserMarkdown("keep <!-- repo:end --> me")).toBe("keep  me");
    expect(extractUserMarkdown("keep\n<!-- repo:end -->\nme")).toBe("keep\nme");
    expect(extractUserMarkdown("keep\n  <!-- repo:end -->  \nme")).toBe("keep\nme");
    expect(extractManagedBody("<!-- repo:begin -->\r\nhello")).toBe("hello");
    expect(extractManagedBody("<!-- repo:begin -->")).toBe("");
    const emptyWrap = composeGuardedMarkdown("<!-- repo:begin -->", "");
    expect(emptyWrap.split(SENTINEL_BEGIN)).toHaveLength(2);
    expect(emptyWrap).toBe("<!-- repo:begin -->\n\n<!-- repo:end -->\n");
    const mixed =
      "<!-- repo:begin -->\nok\n<!-- repo:end -->\nuser bit\n<!-- repo:begin -->\nstale";
    expect(extractManagedBody(mixed)).toBe("ok");
    expect(extractUserMarkdown(mixed)).toBe("user bit\n");
    expect(
      composeGuardedMarkdown("<!-- repo:begin -->\nbody\n<!-- repo:end -->\n", ""),
    ).toBe("<!-- repo:begin -->\n\nbody\n\n<!-- repo:end -->\n");
  });

  it("extract/compose peel stacked dest and trailing orphan end", () => {
    const stacked =
      "<!-- repo:begin -->\n<!-- repo:begin -->\nBODY\n<!-- repo:end -->\n<!-- repo:end -->\n";
    expect(extractManagedBody(stacked)).toBe("BODY");
    const stackedOut = composeGuardedMarkdown(stacked, "");
    expect(stackedOut).toBe("<!-- repo:begin -->\n\nBODY\n\n<!-- repo:end -->\n");
    expect(stackedOut.split(SENTINEL_BEGIN)).toHaveLength(2);
    expect(stackedOut.split(SENTINEL_END)).toHaveLength(2);
    expect(composeGuardedMarkdown("BODY\n<!-- repo:end -->\n", "")).toBe(
      "<!-- repo:begin -->\n\nBODY\n\n<!-- repo:end -->\n",
    );
    expect(extractManagedBody("BODY\n\n<!-- repo:end -->")).toBe("BODY");
    expect(mergeGuardedContent(stacked, "SRC")).toBe(
      "<!-- repo:begin -->\n\nSRC\n\n<!-- repo:end -->\n",
    );
    expect(mergeGuardedContent("keep\n<!-- repo:end -->\n", "SRC")).toBe(
      "<!-- repo:begin -->\n\nSRC\n\n<!-- repo:end -->\n\nkeep\n",
    );
    expect(
      extractManagedBody("<!-- repo:begin --> \nBODY\n<!-- repo:end --> \n"),
    ).toBe("BODY");
    expect(
      extractManagedBody("  <!-- repo:begin -->\nBODY\n  <!-- repo:end -->\n"),
    ).toBe("BODY");
    expect(extractManagedBody("<!-- repo:begin -->\n<!-- repo:end -->")).toBe("");
    expect(
      extractManagedBody(
        "<!-- repo:begin -->\nsee <!-- repo:end --> here\n<!-- repo:end -->\n",
      ),
    ).toBe("see <!-- repo:end --> here");
    const midLine =
      "<!-- repo:begin -->\nBODY\n<!-- repo:end -->\nstill user\n<!-- repo:end -->\n";
    expect(extractManagedBody(midLine)).toBe("BODY");
    expect(extractUserMarkdown(midLine)).toBe("still user\n");
    expect(composeGuardedMarkdown(extractManagedBody(midLine) ?? "", extractUserMarkdown(midLine))).toBe(
      "<!-- repo:begin -->\n\nBODY\n\n<!-- repo:end -->\n\nstill user\n",
    );
  });

  it("remerge restores unsafe, missing, binary current, and created files", () => {
    const dest = tmp("remerge-edges-");
    const agents = path.join(dest, "AGENTS.md");
    const claude = path.join(dest, "CLAUDE.md");
    const gemini = path.join(dest, "GEMINI.md");
    const rawBuf = Buffer.from([0x41, 0x00]);
    fs.writeFileSync(agents, rawBuf);
    fs.writeFileSync(claude, "keep claude\n");
    const snap = snapshotGuardedRoots(dest);
    expect(snap["AGENTS.md"].unsafe).toBe("binary");
    fs.writeFileSync(agents, "clobbered\n");
    fs.rmSync(claude);
    fs.writeFileSync(gemini, "@AGENTS.md\n");
    const binClaude = path.join(dest, "CLAUDE.md");
    remergeGuardedRoots(dest, snap);
    expect(fs.readFileSync(agents)).toEqual(rawBuf);
    expect(fs.readFileSync(claude, "utf8")).toBe("keep claude\n");
    expect(fs.readFileSync(gemini, "utf8")).toBe(
      "<!-- repo:begin -->\n\n@AGENTS.md\n\n<!-- repo:end -->\n",
    );
    fs.writeFileSync(claude, Buffer.from([0x00]));
    remergeGuardedRoots(dest, snap);
    expect(fs.readFileSync(binClaude, "utf8")).toBe("keep claude\n");
    remergeGuardedRoots(dest, {});
    fs.writeFileSync(gemini, Buffer.from([0x00]));
    remergeGuardedRoots(dest, {});
    expect(fs.readFileSync(gemini)).toEqual(Buffer.from([0x00]));
    fs.rmSync(gemini);
    remergeGuardedRoots(dest, {});
    expect(fs.existsSync(gemini)).toBe(false);
  });

  it("remerge clears user when unmarked snap equals new repo body", () => {
    const dest = tmp("remerge-eq-");
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "same\n");
    const snap = snapshotGuardedRoots(dest);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "same\n");
    remergeGuardedRoots(dest, snap);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe("same\n");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- repo:begin -->\nsame\n<!-- repo:end -->\n",
    );
    remergeGuardedRoots(dest, snap);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nsame\n\n<!-- repo:end -->\n",
    );
  });

  it("withGuardedCheckInteriors skips unmarked and unsafe then restores", () => {
    const dest = tmp("check-skip-");
    const live = "plain user\n";
    const rawBuf = Buffer.from([0x00, 0x01]);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), live);
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), rawBuf);
    const ret = withGuardedCheckInteriors(dest, () => {
      expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(live);
      expect(fs.readFileSync(path.join(dest, "CLAUDE.md"))).toEqual(rawBuf);
      return 7;
    });
    expect(ret).toBe(7);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(live);
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"))).toEqual(rawBuf);
  });

  it("runGuardedRoots generate rematches after inner clobber", () => {
    const dest = tmp("guarded-run-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- repo:begin -->\nold\n<!-- repo:end -->\nkeep me\n",
    );
    const exec = vi.fn(() => {
      fs.writeFileSync(path.join(dest, "AGENTS.md"), "fresh ssot\n");
    });
    runGuardedRoots("generate", { cwd: dest, exec });
    expect(exec.mock.calls.map((c) => c[0])).toEqual([
      "rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents,skills",
      "rulesync generate -t claudecode,codexcli,antigravity-cli -f hooks",
      "node .rulesync/scripts/emit-mcp-policy.mjs",
      "node .rulesync/scripts/emit-gemini.mjs",
      "node .rulesync/scripts/emit-agent-shell-tools.mjs",
      "node .rulesync/scripts/emit-maps.mjs",
      "node .rulesync/scripts/hooks-union.mjs",
    ]);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nfresh ssot\n\n<!-- repo:end -->\n\nkeep me\n",
    );
  });

  it("healGuardedRootFile rematches unmarked clobber and keeps later user edits", () => {
    const dest = tmp("heal-watch-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- repo:begin -->\nold\n<!-- repo:end -->\nkeep me\n",
    );
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "user claude\n");
    const snap = snapshotGuardedRoots(dest);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "watch gen 1\n");
    healGuardedRootFile(dest, "AGENTS.md", snap);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nwatch gen 1\n\n<!-- repo:end -->\n\nkeep me\n",
    );
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- repo:begin -->\nwatch gen 1\n<!-- repo:end -->\nedited bottom\n",
    );
    healGuardedRootFile(dest, "AGENTS.md", snap);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "watch gen 2\n");
    healGuardedRootFile(dest, "AGENTS.md", snap);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nwatch gen 2\n\n<!-- repo:end -->\n\nedited bottom\n",
    );
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "watch claude\n");
    healGuardedRootFile(dest, "CLAUDE.md", snap);
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nwatch claude\n\n<!-- repo:end -->\n\nuser claude\n",
    );
    healGuardedRootFile(dest, "README.md", snap);
    expect(GUARDED_ROOT_FILES).toEqual(["AGENTS.md", "CLAUDE.md", "GEMINI.md"]);
    const eq = tmp("heal-eq-");
    fs.writeFileSync(path.join(eq, "AGENTS.md"), "same\n");
    const eqSnap = snapshotGuardedRoots(eq);
    healGuardedRootFile(eq, "AGENTS.md", eqSnap);
    expect(fs.readFileSync(path.join(eq, "AGENTS.md"), "utf8")).toBe("same\n");
    fs.writeFileSync(path.join(eq, "AGENTS.md"), "same");
    healGuardedRootFile(eq, "AGENTS.md", eqSnap);
    expect(fs.readFileSync(path.join(eq, "AGENTS.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nsame\n\n<!-- repo:end -->\n",
    );
    fs.writeFileSync(path.join(eq, "GEMINI.md"), "@AGENTS.md\n");
    healGuardedRootFile(eq, "GEMINI.md", {});
    expect(fs.readFileSync(path.join(eq, "GEMINI.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\n@AGENTS.md\n\n<!-- repo:end -->\n",
    );
  });

  it("healGuardedRootFile restores unsafe clobber and ignores missing", () => {
    const dest = tmp("heal-unsafe-");
    const rawBuf = Buffer.from([0x00, 0x02]);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), rawBuf);
    const snap = snapshotGuardedRoots(dest);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "clobbered\n");
    healGuardedRootFile(dest, "AGENTS.md", snap);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"))).toEqual(rawBuf);
    healGuardedRootFile(dest, "GEMINI.md", snap);
    expect(fs.existsSync(path.join(dest, "GEMINI.md"))).toBe(false);
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "ok\n");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), Buffer.from([0x00]));
    const snap2 = snapshotGuardedRoots(dest);
    snap2["CLAUDE.md"] = { raw: "ok\n", user: "ok\n" };
    healGuardedRootFile(dest, "CLAUDE.md", snap2);
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe("ok\n");
    fs.writeFileSync(path.join(dest, "GEMINI.md"), Buffer.from([0x00]));
    healGuardedRootFile(dest, "GEMINI.md", {});
    expect(fs.readFileSync(path.join(dest, "GEMINI.md"))).toEqual(Buffer.from([0x00]));
  });

  it("runGuardedRoots watch rematches after each inner clobber", () => {
    const dest = tmp("guarded-watch-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- repo:begin -->\nold\n<!-- repo:end -->\nkeep me\n",
    );
    let heal;
    const exec = vi.fn(() => {
      fs.writeFileSync(path.join(dest, "AGENTS.md"), "watch1\n");
      heal("AGENTS.md");
      expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
        "<!-- repo:begin -->\n\nwatch1\n\n<!-- repo:end -->\n\nkeep me\n",
      );
      fs.writeFileSync(path.join(dest, "AGENTS.md"), "watch2\n");
      heal("AGENTS.md");
    });
    const stop = vi.fn();
    runGuardedRoots("watch", {
      cwd: dest,
      exec,
      attachWatchers: ({ heal: h }) => {
        heal = h;
        return stop;
      },
    });
    expect(exec.mock.calls.map((c) => c[0])).toEqual([
      "node .rulesync/scripts/emit-mcp-policy.mjs",
      "node .rulesync/scripts/emit-gemini.mjs",
      "node .rulesync/scripts/emit-agent-shell-tools.mjs",
      "rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents,skills --watch",
    ]);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nwatch2\n\n<!-- repo:end -->\n\nkeep me\n",
    );
  });

  it("runGuardedRoots watch default watchers still rematch on exit", () => {
    const dest = tmp("guarded-watch-def-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- repo:begin -->\nold\n<!-- repo:end -->\nkeep me\n",
    );
    const exec = vi.fn(() => {
      fs.writeFileSync(path.join(dest, "AGENTS.md"), "from-watch\n");
    });
    runGuardedRoots("watch", { cwd: dest, exec });
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nfrom-watch\n\n<!-- repo:end -->\n\nkeep me\n",
    );
    expect(() => runGuardedRoots("nope")).toThrow(/generate\|check\|watch/);
  });
});

describe("copyTree", () => {
  it("copies nested files, overwrites existing ones, and honors the filter", () => {
    const src = tmp("copytree-src-");
    fs.mkdirSync(path.join(src, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(src, "a", "b", "keep.txt"), "new");
    fs.writeFileSync(path.join(src, "a", "skip.txt"), "skip");
    fs.writeFileSync(path.join(src, "top.txt"), "top");
    const dest = tmp("copytree-dest-");
    fs.mkdirSync(path.join(dest, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(dest, "a", "b", "keep.txt"), "old");
    fs.writeFileSync(path.join(dest, "mine.txt"), "mine");

    copyTree(src, dest, (s) => path.basename(s) !== "skip.txt");

    expect(fs.readFileSync(path.join(dest, "a", "b", "keep.txt"), "utf8")).toBe("new");
    expect(fs.readFileSync(path.join(dest, "top.txt"), "utf8")).toBe("top");
    expect(fs.existsSync(path.join(dest, "a", "skip.txt"))).toBe(false);
    expect(fs.readFileSync(path.join(dest, "mine.txt"), "utf8")).toBe("mine");
  });

});

describe("mergeClaudeSettings", () => {
  it("dest .claude/settings.json absent: plain copy", () => {
    const pkgRoot = stubPkgRoot();
    const destRoot = tmp("settings-absent-");
    mergeClaudeSettings(destRoot, pkgRoot);
    const out = JSON.parse(
      fs.readFileSync(path.join(destRoot, ".claude", "settings.json"), "utf8"),
    );
    expect(out).toEqual(SRC_CLAUDE_SETTINGS);
  });

  it("re-merge is a byte-for-byte no-op (no empty allow added)", () => {
    const pkgRoot = stubPkgRoot();
    const destRoot = tmp("settings-idempotent-");
    mergeClaudeSettings(destRoot, pkgRoot);
    const settingsPath = path.join(destRoot, ".claude", "settings.json");
    const first = fs.readFileSync(settingsPath, "utf8");
    mergeClaudeSettings(destRoot, pkgRoot);
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(first);
    expect(JSON.parse(first).permissions).not.toHaveProperty("allow");
  });

  it("keeps an empty allow list the consumer wrote", () => {
    const pkgRoot = stubPkgRoot();
    const destRoot = tmp("settings-empty-allow-");
    fs.mkdirSync(path.join(destRoot, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(destRoot, ".claude", "settings.json"),
      JSON.stringify({ permissions: { allow: [] } }),
    );
    mergeClaudeSettings(destRoot, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(destRoot, ".claude", "settings.json"), "utf8"));
    expect(out.permissions.allow).toEqual([]);
  });

  it("malformed dest JSON throws with the path in the message", () => {
    const pkgRoot = stubPkgRoot();
    const destRoot = tmp("settings-malformed-");
    const destSettingsPath = path.join(destRoot, ".claude", "settings.json");
    fs.mkdirSync(path.join(destRoot, ".claude"), { recursive: true });
    fs.writeFileSync(destSettingsPath, "{ not valid json");
    expect(() => mergeClaudeSettings(destRoot, pkgRoot)).toThrowError(
      new RegExp(destSettingsPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("consumer hook group with only OWNED commands is replaced", () => {
    const pkgRoot = stubPkgRoot();
    const destRoot = tmp("settings-owned-");
    fs.mkdirSync(path.join(destRoot, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(destRoot, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { deny: ["Agent(Explore)"] },
        hooks: {
          PreToolUse: [
            {
              matcher: "spawn",
              hooks: [
                {
                  type: "command",
                  command: 'node "${OLD_ROOT}/.rulesync/scripts/scrub-spawn-prompt.mjs"',
                },
              ],
            },
          ],
        },
        enableAllProjectMcpServers: true,
        enabledMcpjsonServers: ["stale"],
      }),
    );
    mergeClaudeSettings(destRoot, pkgRoot);
    const out = JSON.parse(
      fs.readFileSync(path.join(destRoot, ".claude", "settings.json"), "utf8"),
    );
    expect(out.hooks.PreToolUse).toEqual(SRC_CLAUDE_SETTINGS.hooks.PreToolUse);
    expect(out.hooks.Stop).toEqual(SRC_CLAUDE_SETTINGS.hooks.Stop);
    expect(out.enableAllProjectMcpServers).toBe(false);
    expect(out.enabledMcpjsonServers).toEqual([]);
  });

  it("consumer hook group with only consumer commands survives", () => {
    const pkgRoot = stubPkgRoot();
    const destRoot = tmp("settings-consumer-");
    fs.mkdirSync(path.join(destRoot, ".claude"), { recursive: true });
    const consumerGroup = {
      matcher: "custom",
      hooks: [{ type: "command", command: "node scripts/my-custom-hook.mjs" }],
    };
    fs.writeFileSync(
      path.join(destRoot, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { deny: ["Agent(Explore)"] },
        hooks: { PreToolUse: [consumerGroup] },
      }),
    );
    mergeClaudeSettings(destRoot, pkgRoot);
    const out = JSON.parse(
      fs.readFileSync(path.join(destRoot, ".claude", "settings.json"), "utf8"),
    );
    expect(out.hooks.PreToolUse).toEqual([consumerGroup, ...SRC_CLAUDE_SETTINGS.hooks.PreToolUse]);
    // event absent from dest entirely still gets appended
    expect(out.hooks.Stop).toEqual(SRC_CLAUDE_SETTINGS.hooks.Stop);
  });

  it("MIXED group (one OWNED + one consumer command) survives intact", () => {
    const pkgRoot = stubPkgRoot();
    const destRoot = tmp("settings-mixed-");
    fs.mkdirSync(path.join(destRoot, ".claude"), { recursive: true });
    const mixedGroup = {
      matcher: "mixed",
      hooks: [
        { type: "command", command: 'node "${OLD_ROOT}/.rulesync/scripts/gate-fat-tools.mjs"' },
        { type: "command", command: "node scripts/my-custom-hook.mjs" },
      ],
    };
    fs.writeFileSync(
      path.join(destRoot, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { deny: [] },
        hooks: { PreToolUse: [mixedGroup] },
      }),
    );
    mergeClaudeSettings(destRoot, pkgRoot);
    const out = JSON.parse(
      fs.readFileSync(path.join(destRoot, ".claude", "settings.json"), "utf8"),
    );
    expect(out.hooks.PreToolUse).toEqual([mixedGroup, ...SRC_CLAUDE_SETTINGS.hooks.PreToolUse]);
  });

  it("permissions.deny union does not grow on a second run (idempotency)", () => {
    const pkgRoot = stubPkgRoot();
    const destRoot = tmp("settings-idempotent-");
    fs.mkdirSync(path.join(destRoot, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(destRoot, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { deny: ["Agent(Explore)", "Agent(Plan)"] },
        hooks: {},
      }),
    );
    mergeClaudeSettings(destRoot, pkgRoot);
    const first = JSON.parse(
      fs.readFileSync(path.join(destRoot, ".claude", "settings.json"), "utf8"),
    );
    mergeClaudeSettings(destRoot, pkgRoot);
    const second = JSON.parse(
      fs.readFileSync(path.join(destRoot, ".claude", "settings.json"), "utf8"),
    );
    expect(second.permissions.deny).toEqual(first.permissions.deny);
    expect(second.permissions.deny).toEqual([
      "Agent(Explore)",
      "Agent(Plan)",
      "mcp__*",
    ]);
    expect(second.permissions.allow).toEqual(first.permissions.allow);
  });

  it("unknown consumer top-level key preserved; missing hooks/permissions default to empty", () => {
    const pkgRoot = stubPkgRoot();
    const destRoot = tmp("settings-unknown-key-");
    fs.mkdirSync(path.join(destRoot, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(destRoot, ".claude", "settings.json"),
      JSON.stringify({ someCustomFlag: true }),
    );
    mergeClaudeSettings(destRoot, pkgRoot);
    const out = JSON.parse(
      fs.readFileSync(path.join(destRoot, ".claude", "settings.json"), "utf8"),
    );
    expect(out.someCustomFlag).toBe(true);
    expect(out.hooks).toEqual(SRC_CLAUDE_SETTINGS.hooks);
    expect(out.permissions.deny).toEqual(SRC_CLAUDE_SETTINGS.permissions.deny);
  });
});

describe("toScriptName", () => {
  it("prefixes unprefixed keys and does not double-prefix", () => {
    expect(toScriptName("rulesync:generate")).toBe("repo:rulesync:generate");
    expect(toScriptName("repo:doctor")).toBe("repo:doctor");
  });
});

describe("mergePackageJson", () => {
  it("creates {} dest and merges scripts skipping test, injects deps, sorts keys", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-new-");
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts).toEqual({
      "repo:alpha": "a",
      "repo:antigravity": LAUNCH_SCRIPTS.antigravity,
      "repo:claude": LAUNCH_SCRIPTS.claude,
      "repo:codex": LAUNCH_SCRIPTS.codex,
      "repo:gemini": LAUNCH_SCRIPTS.gemini,
      "repo:grok": LAUNCH_SCRIPTS.grok,
      "repo:rulesync:generate": "gen",
      "repo:zeta": "z",
    });
    expect(Object.keys(out.scripts)).toEqual([
      "repo:alpha",
      "repo:antigravity",
      "repo:claude",
      "repo:codex",
      "repo:gemini",
      "repo:grok",
      "repo:rulesync:generate",
      "repo:zeta",
    ]);
    expect(out.devDependencies).toEqual({
      rulesync: "latest",
      "smol-toml": "^1.8.0",
    });
    expect(Object.keys(out.devDependencies)).toEqual(["rulesync", "smol-toml"]);
    expect(out.scripts.test).toBeUndefined();
  });

  it("merges over existing dest scripts/deps, keeps dest test", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-exist-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        name: "app",
        scripts: { test: "jest", alpha: "old", foo: "bar" },
        devDependencies: { lodash: "4" },
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts.test).toBe("jest");
    expect(out.scripts.alpha).toBe("old");
    expect(out.scripts["repo:alpha"]).toBe("a");
    expect(out.scripts["repo:zeta"]).toBe("z");
    expect(out.scripts.foo).toBe("bar");
    expect(out.devDependencies.lodash).toBe("4");
    expect(out.devDependencies["smol-toml"]).toBe("^1.8.0");
    expect(out.devDependencies.rulesync).toBe("latest");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("preserves dest suffix after an upgraded repo script prefix", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "rulesync generate -t bar" },
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-suffix-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: {
          "repo:rulesync:generate": "rulesync generate -t foo && node scripts/codex-sync.mjs",
        },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:rulesync:generate"]).toBe(
      "rulesync generate -t bar && node scripts/codex-sync.mjs",
    );
    expect(out.scripts["rulesync:generate"]).toBeUndefined();
  });

  it("preserves suffix after a multi-command repo script upgrade", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: {
        "rulesync:generate": "rulesync generate -t bar && node scripts/emit.mjs",
      },
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-multi-suffix-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: {
          "repo:rulesync:generate":
            "rulesync generate -t foo && node scripts/emit.mjs && node scripts/codex-sync.mjs",
        },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:rulesync:generate"]).toBe(
      "rulesync generate -t bar && node scripts/emit.mjs && node scripts/codex-sync.mjs",
    );
  });

  it("keeps a non-owned repo: script with extra && commands", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { alpha: "a" },
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-nonowned-suffix-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ scripts: { "repo:alpha": "echo custom && extra" } }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:alpha"]).toBe("echo custom && extra");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls through suffix scan when extra commands use bare semicolons", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "rulesync generate -t bar" },
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-semi-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: { "repo:rulesync:generate": "echo custom;echo extra" },
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:rulesync:generate"]).toBe("echo custom;echo extra");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("keeps dest when dest script already equals src", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "rulesync generate -t bar" },
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-equal-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ scripts: { "repo:rulesync:generate": "rulesync generate -t bar" } }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:rulesync:generate"]).toBe("rulesync generate -t bar");
    expect(out.scripts["rulesync:generate"]).toBeUndefined();
  });

  it("keeps dest when it already starts with the new src value plus suffix", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "rulesync generate -t bar" },
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-prefix-");
    const cur = "rulesync generate -t bar && node scripts/codex-sync.mjs";
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ scripts: { "repo:rulesync:generate": cur } }));
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:rulesync:generate"]).toBe(cur);
    expect(out.scripts["rulesync:generate"]).toBeUndefined();
  });

  it("keeps unrelated custom script values and dest-only keys without a warning", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-unrelated-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: { alpha: "echo custom", foo: "bar", test: "jest" },
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts.alpha).toBe("echo custom");
    expect(out.scripts["repo:alpha"]).toBe("a");
    expect(out.scripts.foo).toBe("bar");
    expect(out.scripts.test).toBe("jest");
    expect(out.scripts["repo:zeta"]).toBe("z");
    expect(out.scripts.zeta).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("does not merge :raw scripts from src", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: {
        "rulesync:generate": "node ./.rulesync/scripts/guarded-roots.mjs generate",
        "rulesync:generate:raw": "echo raw",
        "rulesync:check:raw": "echo check-raw",
        "rulesync:watch:raw": "echo watch-raw",
      },
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-raw-src-");
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:rulesync:generate"]).toBe("node ./.rulesync/scripts/guarded-roots.mjs generate");
    expect(out.scripts["rulesync:generate"]).toBeUndefined();
    expect(out.scripts["rulesync:generate:raw"]).toBeUndefined();
    expect(out.scripts["rulesync:check:raw"]).toBeUndefined();
    expect(out.scripts["rulesync:watch:raw"]).toBeUndefined();
  });

  it("leaves dest-only :raw keys", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "node ./.rulesync/scripts/guarded-roots.mjs generate" },
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-raw-dest-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: { "rulesync:generate:raw": "echo consumer-raw" },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:rulesync:generate"]).toBe("node ./.rulesync/scripts/guarded-roots.mjs generate");
    expect(out.scripts["rulesync:generate:raw"]).toBe("echo consumer-raw");
  });

  it("replaces a repo-owned script with no suffix", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "rulesync generate -t bar", "sync:globals:apply": "node .rulesync/scripts/sync-global-settings.mjs --apply" },
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-owned-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: { "repo:rulesync:generate": "rulesync generate -t foo" },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:rulesync:generate"]).toBe("rulesync generate -t bar");
    expect(out.scripts["repo:sync:globals:apply"]).toBe("node .rulesync/scripts/sync-global-settings.mjs --apply");
    expect(out.scripts["rulesync:generate"]).toBeUndefined();
  });

  it("early return when name is @workerstack/repo", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-self-");
    const raw = `${JSON.stringify({ name: "@workerstack/repo", scripts: { test: "x" } }, null, 2)}\n`;
    fs.writeFileSync(path.join(dest, "package.json"), raw);
    mergePackageJson(dest, pkgRoot);
    expect(fs.readFileSync(path.join(dest, "package.json"), "utf8")).toBe(raw);
  });

  it("src without scripts uses empty object", () => {
    const pkgRoot = stubPkgRoot({
      name: "no-scripts",
      dependencies: { "smol-toml": "1" },
      devDependencies: { rulesync: "2" },
    });
    const dest = tmp("pj-noscripts-");
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts).toEqual({
      "repo:antigravity": LAUNCH_SCRIPTS.antigravity,
      "repo:claude": LAUNCH_SCRIPTS.claude,
      "repo:codex": LAUNCH_SCRIPTS.codex,
      "repo:gemini": LAUNCH_SCRIPTS.gemini,
      "repo:grok": LAUNCH_SCRIPTS.grok,
    });
    expect(out.devDependencies).toEqual({ rulesync: "2", "smol-toml": "1" });
  });

  it("leaves custom doctor and writes repo:doctor from SoT", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { doctor: "node ./.rulesync/scripts/doctor.mjs" },
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-custom-doctor-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ scripts: { doctor: "node scripts/audit.mjs" } }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts.doctor).toBe("node scripts/audit.mjs");
    expect(out.scripts["repo:doctor"]).toBe("node ./.rulesync/scripts/doctor.mjs");
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("moves @workerstack/repo from dependencies to devDependencies", () => {
    const pkgRoot = stubPkgRoot({
      name: PACKAGE_NAME,
      version: "0.6.2",
      scripts: { "rulesync:generate": "gen" },
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-repo-dep-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        name: "app",
        dependencies: { [PACKAGE_NAME]: "0.6.2", lodash: "4" },
        scripts: {},
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.dependencies).toEqual({ lodash: "4" });
    expect(out.devDependencies[PACKAGE_NAME]).toBe("0.6.2");
  });

  it("drops empty dependencies after moving repo", () => {
    const pkgRoot = stubPkgRoot({
      name: PACKAGE_NAME,
      version: "0.7.0",
      scripts: {},
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-repo-onlydep-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ dependencies: { [PACKAGE_NAME]: "0.6.2" } }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.dependencies).toBeUndefined();
    expect(out.devDependencies[PACKAGE_NAME]).toBe("0.6.2");
  });

  it("adds missing repo as a devDependency from the running package version", () => {
    const pkgRoot = stubPkgRoot({
      name: PACKAGE_NAME,
      version: "0.7.0",
      scripts: {},
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-repo-add-");
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app" }));
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.devDependencies[PACKAGE_NAME]).toBe("0.7.0");
  });

  it("keeps an existing repo devDependency version", () => {
    const pkgRoot = stubPkgRoot({
      name: PACKAGE_NAME,
      version: "0.7.0",
      scripts: {},
      dependencies: { "smol-toml": "^1.8.0" },
      devDependencies: { rulesync: "latest" },
    });
    const dest = tmp("pj-repo-keep-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        devDependencies: { [PACKAGE_NAME]: "^0.6.2" },
        dependencies: { [PACKAGE_NAME]: "0.6.2" },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.dependencies).toBeUndefined();
    expect(out.devDependencies[PACKAGE_NAME]).toBe("^0.6.2");
  });

  it("placeDevDependency is a no-op when src is not repo", () => {
    const destPkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {
      dependencies: { lodash: "4" },
    };
    placeDevDependency(destPkg, { name: "fixture-pkg", version: "1.0.0" });
    expect(destPkg.dependencies).toEqual({ lodash: "4" });
    expect(destPkg.devDependencies?.[PACKAGE_NAME]).toBeUndefined();
  });

  it("emits repo:claude into a consumer package.json", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-launch-emit-");
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:claude"]).toBe(LAUNCH_SCRIPTS.claude);
  });

  it("leaves a consumer's bare claude launcher untouched, no warn emitted", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-consumer-claude-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ scripts: { claude: "bun run build && claude" } }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts.claude).toBe("bun run build && claude");
    expect(out.scripts["repo:claude"]).toBe(LAUNCH_SCRIPTS.claude);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not rewrite bun run claude inside a consumer script", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-bunrun-claude-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: { claude: "bun run build && claude", start: "bun run claude" },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts.start).toBe("bun run claude");
  });

  it("drift: every bare launcher key in repo's package.json equals LAUNCH_SCRIPTS[key]", () => {
    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
        "utf8",
      ),
    );
    for (const [k, v] of Object.entries(LAUNCH_SCRIPTS)) {
      expect(pkg.scripts[k]).toBe(v);
    }
  });

  it("keeps customized repo launchers that are not a known default", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-keep-custom-launch-");
    const wrapped = {
      "repo:antigravity": "node scripts/with-env.mjs agy --dangerously-skip-permissions",
      "repo:claude": "node scripts/with-env.mjs claude --dangerously-skip-permissions",
      "repo:codex": "node scripts/with-env.mjs codex --dangerously-bypass-approvals-and-sandbox",
      "repo:gemini": "node scripts/with-env.mjs gemini --yolo",
      "repo:grok": "node scripts/with-env.mjs grok --yolo",
    };
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ scripts: wrapped }));
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:antigravity"]).toBe(wrapped["repo:antigravity"]);
    expect(out.scripts["repo:claude"]).toBe(wrapped["repo:claude"]);
    expect(out.scripts["repo:codex"]).toBe(wrapped["repo:codex"]);
    expect(out.scripts["repo:gemini"]).toBe(wrapped["repo:gemini"]);
    expect(out.scripts["repo:grok"]).toBe(wrapped["repo:grok"]);
  });

  it("does not add repo:test:e2e when dest has no e2e vitest config", () => {
    const dest = tmp("pj-noe2e-");
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app", scripts: {} }));
    mergePackageJson(dest, PKG_ROOT);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:test:e2e"]).toBeUndefined();
    expect(out.scripts["repo:rulesync:check"]).toBe("node ./.rulesync/scripts/guarded-roots.mjs check");
  });

  it("adds repo:test:e2e when dest has a vitest e2e config", () => {
    const dest = tmp("pj-e2e-");
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app", scripts: {} }));
    fs.writeFileSync(path.join(dest, E2E_VITEST_CONFIGS[0]), "export default {}\n");
    mergePackageJson(dest, PKG_ROOT);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:test:e2e"]).toBe("vitest run -c vitest.e2e.config.ts");
  });

  it("leaves a repo's own test:e2e alone when it runs repo's command after one of its own", () => {
    const dest = tmp("pj-e2e-own-");
    const own = "bun run build && vitest run -c vitest.e2e.config.ts";
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app", scripts: { "test:e2e": own } }));
    fs.writeFileSync(path.join(dest, E2E_VITEST_CONFIGS[0]), "export default {}\n");
    mergePackageJson(dest, PKG_ROOT);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["test:e2e"]).toBe(own);
    // The repo runs its own e2e: a second, repo's, would run it again without the repo's own steps.
    expect(out.scripts["repo:test:e2e"]).toBeUndefined();
  });

  it("keeps an existing repo:test:e2e even without an e2e config", () => {
    const dest = tmp("pj-e2e-keep-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ scripts: { "repo:test:e2e": "node scripts/e2e.mjs" } }),
    );
    mergePackageJson(dest, PKG_ROOT);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["repo:test:e2e"]).toBe("node scripts/e2e.mjs");
  });
});

describe("reference markdown merge", () => {
  it("extraH2Sections keeps titles incoming does not have, including CRLF", () => {
    const existing = "# Law\r\n\r\n## Skills naming\r\n\r\nstock\r\n\r\n## Autorun\r\n\r\ngo-live\r\n";
    const incoming = "# Law\n\n## Skills naming\n\nstock plus su\n";
    expect(extraH2Sections(existing, incoming)).toBe("## Autorun\n\ngo-live");
    expect(extraH2Sections("# Law\n\nno headings\n", incoming)).toBe("");
    expect(extraH2Sections("## \nempty title\n## Autorun\nkeep\n", incoming)).toBe("## Autorun\nkeep");
  });

  it("mergeReferenceMarkdown appends extras and normalizes a trailing newline", () => {
    const incoming = "# Law\n\n## Skills naming\n\nstock";
    expect(mergeReferenceMarkdown("", incoming)).toBe("# Law\n\n## Skills naming\n\nstock\n");
    expect(mergeReferenceMarkdown("# Law\n\n## Skills naming\n\nstock\n\n## Autorun\n\nX\n", incoming)).toBe(
      "# Law\n\n## Skills naming\n\nstock\n\n## Autorun\n\nX\n",
    );
  });

  it("snapshotReferenceDocs skips generated maps, non-md, and directories", () => {
    const dest = tmp("ref-snap-");
    expect(snapshotReferenceDocs(dest)).toEqual({});
    const dir = path.join(dest, ".rulesync", "reference");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "law.md"), "# Law\n");
    fs.writeFileSync(path.join(dir, "INDEX.md"), "generated\n");
    fs.writeFileSync(path.join(dir, "notes.txt"), "nope\n");
    fs.mkdirSync(path.join(dir, "nested.md"));
    expect(snapshotReferenceDocs(dest)).toEqual({ "law.md": "# Law\n" });
  });

  it("remergeReferenceDocs writes extras for packaged refs and leaves consumer-only files", () => {
    const pkgRoot = stubPkgRoot();
    const pkgRef = path.join(pkgRoot, ".rulesync", "reference");
    fs.mkdirSync(pkgRef, { recursive: true });
    fs.writeFileSync(path.join(pkgRef, "law.md"), "# Law\n\n## Skills naming\n\nstock\n");
    const dest = tmp("ref-remerge-");
    const destRef = path.join(dest, ".rulesync", "reference");
    fs.mkdirSync(destRef, { recursive: true });
    fs.writeFileSync(
      path.join(destRef, "law.md"),
      "# Law\n\n## Skills naming\n\nold\n\n## Autorun\n\nkeep\n",
    );
    fs.writeFileSync(path.join(destRef, "stripe.md"), "# Stripe\n");
    remergeReferenceDocs(
      dest,
      {
        "law.md": fs.readFileSync(path.join(destRef, "law.md"), "utf8"),
        "stripe.md": "# Stripe\n",
      },
      pkgRoot,
    );
    expect(fs.readFileSync(path.join(destRef, "law.md"), "utf8")).toBe(
      "# Law\n\n## Skills naming\n\nstock\n\n## Autorun\n\nkeep\n",
    );
    expect(fs.readFileSync(path.join(destRef, "stripe.md"), "utf8")).toBe("# Stripe\n");
  });
});

describe("pipeline seed", () => {
  it("writes skip overlay from dest pipeline and does not overwrite an existing file", () => {
    const dest = tmp("pipe-seed-");
    const skipped = PIPELINE_COMMANDS.check[1];
    const src = `export const COMMANDS = {
  check: [
    ${PIPELINE_COMMANDS.check.filter((c) => c !== skipped).map((c) => JSON.stringify(c)).join(",\n    ")}
  ],
};
`;
    expect(seedPipelineConfig(dest, src)).toBe(true);
    const cfg = path.join(dest, PIPELINE_CONFIG_REL);
    expect(JSON.parse(fs.readFileSync(cfg, "utf8"))).toEqual({ check: { skip: [skipped] } });
    fs.writeFileSync(cfg, '{"check":{"skip":["keep"]}}\n');
    expect(seedPipelineConfig(dest, src)).toBe(false);
    expect(JSON.parse(fs.readFileSync(cfg, "utf8"))).toEqual({ check: { skip: ["keep"] } });
  });

  it("skips seed when dest is not a COMMANDS module or matches stock", () => {
    const dest = tmp("pipe-seed-skip-");
    expect(seedPipelineConfig(dest, "")).toBe(false);
    expect(seedPipelineConfig(dest, "console.log(1)\n")).toBe(false);
    const stock = `export const COMMANDS = {
  generate: [${PIPELINE_COMMANDS.generate.map((c) => JSON.stringify(c)).join(", ")}],
  check: [${PIPELINE_COMMANDS.check.map((c) => JSON.stringify(c)).join(", ")}],
  watch: [${PIPELINE_COMMANDS.watch.map((c) => JSON.stringify(c)).join(", ")}],
};
`;
    expect(seedPipelineConfig(dest, stock)).toBe(false);
    expect(fs.existsSync(path.join(dest, PIPELINE_CONFIG_REL))).toBe(false);
  });
});

describe("init", () => {
  it("self-skip: copies + gitignore, no exec, no package merge", () => {
    const pkgRoot = stubPkgRoot();
    const exec = vi.fn();
    init(pkgRoot, { pkgRoot, execFileSync: exec });
    expect(exec).not.toHaveBeenCalled();
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
    expect(pkg.name).toBe("fixture-pkg");
    expect(fs.existsSync(path.join(pkgRoot, ".tmp"))).toBe(true);
    expect(fs.readFileSync(path.join(pkgRoot, ".gitignore"), "utf8")).toBe(GI);
    expect(fs.readFileSync(path.join(pkgRoot, ".rulesync", "scripts", "job.mjs"), "utf8")).toBe(
      "job.mjs",
    );
    // self-skip: markdown/settings stay exactly as-is, no sentinel wrap
    expect(fs.readFileSync(path.join(pkgRoot, "CLAUDE.md"), "utf8")).toBe("CLAUDE.md content");
    const settings = JSON.parse(
      fs.readFileSync(path.join(pkgRoot, ".claude", "settings.json"), "utf8"),
    );
    expect(settings).toEqual(SRC_CLAUDE_SETTINGS);
  });

  it("non-self: file vs dir product scripts, guarded md + settings merge, then bun pipeline in order", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("repo-dest-");
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec });

    for (const d of COPY_DIRS) {
      if (d === ".claude") continue;
      expect(fs.readFileSync(path.join(dest, d, "marker"), "utf8")).toBe(d);
    }
    expect(fs.readFileSync(path.join(dest, ".claude", "marker"), "utf8")).toBe(".claude");
    const settings = JSON.parse(
      fs.readFileSync(path.join(dest, ".claude", "settings.json"), "utf8"),
    );
    expect(settings).toEqual(SRC_CLAUDE_SETTINGS);

    for (const f of GUARDED_MD_FILES) {
      expect(fs.readFileSync(path.join(dest, f), "utf8")).toBe(
        `<!-- repo:begin -->\n\n${f} content\n\n<!-- repo:end -->\n`,
      );
    }
    expect(fs.existsSync(path.join(dest, ".mcp.json"))).toBe(false);

    for (const name of PRODUCT_FILES) {
      const optional = ["speak.mjs", "listen.mjs", "google-workspace.mjs"].includes(name);
      expect(fs.existsSync(path.join(dest, ".rulesync", "scripts", name)), name).toBe(!optional);
    }
    expect(fs.statSync(path.join(dest, ".rulesync", "scripts", "scrub-text")).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(dest, ".rulesync", "scripts", "scrub-text", "inside"), "utf8")).toBe(
      "dir",
    );

    const destPkg = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(destPkg.scripts.test).toBeUndefined();
    expect(destPkg.devDependencies["smol-toml"]).toBe("^1.8.0");

    expect(exec.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["bun", ["install"]],
      ["bun", ["run", "repo:rulesync:generate"]],
      ["bun", ["run", "repo:sync:globals:apply"]],
      ["bun", ["run", "repo:rulesync:check"]],
    ]);
    for (const call of exec.mock.calls) {
      expect(call[2]).toEqual({ cwd: dest, stdio: "inherit" });
    }
  });

  it("re-running init on an already-initialized dest merges settings.json instead of clobbering", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("repo-rerun-");
    const exec = vi.fn();
    fs.mkdirSync(path.join(dest, ".claude"), { recursive: true });
    const consumerGroup = {
      matcher: "custom",
      hooks: [{ type: "command", command: "node scripts/my-custom-hook.mjs" }],
    };
    fs.writeFileSync(
      path.join(dest, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { deny: ["Agent(Explore)"] },
        hooks: { PreToolUse: [consumerGroup] },
        someCustomFlag: true,
      }),
    );
    init(dest, { pkgRoot, execFileSync: exec });
    const settings = JSON.parse(
      fs.readFileSync(path.join(dest, ".claude", "settings.json"), "utf8"),
    );
    expect(settings.someCustomFlag).toBe(true);
    expect(settings.hooks.PreToolUse).toEqual([
      consumerGroup,
      ...SRC_CLAUDE_SETTINGS.hooks.PreToolUse,
    ]);
    expect(settings.permissions.deny).toContain("Agent(Explore)");
    expect(settings.permissions.deny).toContain("mcp__*");
  });

  it("re-init replaces a prior repo session-map SessionStart group instead of duplicating it", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("repo-rerun-map-");
    fs.mkdirSync(path.join(dest, ".claude"), { recursive: true });
    const mapGroup = {
      hooks: [{ type: "command", command: 'node "$X/scripts/session-map.mjs"', timeout: 5 }],
    };
    fs.writeFileSync(
      path.join(dest, ".claude", "settings.json"),
      JSON.stringify({ permissions: {}, hooks: { SessionStart: [mapGroup] } }),
    );
    init(dest, { pkgRoot, execFileSync: vi.fn() });
    const settings = JSON.parse(
      fs.readFileSync(path.join(dest, ".claude", "settings.json"), "utf8"),
    );
    expect(settings.hooks.SessionStart).toEqual(SRC_CLAUDE_SETTINGS.hooks.SessionStart);
  });

  it("omitted execFileSync uses default; self-skip never invokes it", () => {
    const pkgRoot = stubPkgRoot();
    init(pkgRoot, { pkgRoot });
    expect(fs.existsSync(path.join(pkgRoot, "AGENTS.md"))).toBe(true);
    expect(fs.readFileSync(path.join(pkgRoot, ".gitignore"), "utf8")).toBe(GI);
  });

  it("reserves every packaged skill name", () => {
    expect(RESERVED_SKILLS).toEqual([
      "ask",
      "auto",
      "blast-radius",
      "bro",
      "browser",
      "clasp",
      "commit",
      "commit-and-push",
      "commit-push",
      "commit-push-deploy",
      "commit-push-release",
      "correct",
      "explain",
      "google-workspace",
      "handoff",
      "implement-plan",
      "implement-roadmap",
      "jev",
      "listen",
      "pickup",
      "principle-attack-the-premise",
      "principle-boundary-discipline",
      "principle-build-the-lever",
      "principle-encode-lessons-in-structure",
      "principle-exhaust-the-design-space",
      "principle-experience-first",
      "principle-explain-the-number",
      "principle-fix-root-causes",
      "principle-foundational-thinking",
      "principle-guard-the-context-window",
      "principle-laziness-protocol",
      "principle-make-operations-idempotent",
      "principle-migrate-callers-then-delete-legacy-apis",
      "principle-minimize-reader-load",
      "principle-model-the-domain",
      "principle-never-block-on-the-human",
      "principle-outcome-oriented-execution",
      "principle-prove-it-works",
      "principle-redesign-from-first-principles",
      "principle-separate-before-serializing-shared-state",
      "principle-sequence-verifiable-units",
      "principle-subtract-before-you-add",
      "principle-test-behavior-not-implementation",
      "principle-type-system-discipline",
      "review-plan",
      "review-roadmap",
      "speak",
      "su",
      "teach",
      "tmp",
      "typescript-best-practices",
      "unslop",
      "write-plan",
      "write-roadmap",
    ]);
  });

  it("prunes reserved skills the package no longer ships; keeps consumer skills", () => {
    const pkgRoot = stubPkgRoot();
    fs.mkdirSync(path.join(pkgRoot, ".rulesync", "skills", "tmp"), { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, ".rulesync", "skills", "tmp", "SKILL.md"), "pkg tmp");
    const dest = tmp("repo-prune-extra-");
    fs.mkdirSync(path.join(dest, ".rulesync", "skills", "tmp"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".rulesync", "skills", "tmp", "SKILL.md"), "old tmp");
    fs.mkdirSync(path.join(dest, ".rulesync", "skills", "browser"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".rulesync", "skills", "browser", "SKILL.md"), "stale reserved");
    fs.mkdirSync(path.join(dest, ".rulesync", "skills", "acme"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".rulesync", "skills", "acme", "SKILL.md"), "consumer");
    init(dest, { pkgRoot, execFileSync: vi.fn() });
    expect(fs.readFileSync(path.join(dest, ".rulesync", "skills", "tmp", "SKILL.md"), "utf8")).toBe(
      "pkg tmp",
    );
    expect(fs.existsSync(path.join(dest, ".rulesync", "skills", "browser"))).toBe(false);
    expect(fs.readFileSync(path.join(dest, ".rulesync", "skills", "acme", "SKILL.md"), "utf8")).toBe(
      "consumer",
    );
    pruneRetired(dest, { pkgRoot });
  });

  it("ships lessons.mjs and the review-plan skill, never the package lessons, and keeps consumer lessons", () => {
    const pkgRoot = stubPkgRoot();
    fs.mkdirSync(path.join(pkgRoot, ".rulesync", "lessons"), { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, ".rulesync", "lessons", "repo-own.md"), "package lesson");
    fs.mkdirSync(path.join(pkgRoot, ".rulesync", "skills", "review-plan"), { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, ".rulesync", "skills", "review-plan", "SKILL.md"), "review");
    const dest = tmp("repo-lessons-");
    fs.mkdirSync(path.join(dest, ".rulesync", "lessons"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".rulesync", "lessons", "mine.md"), "consumer lesson");
    for (let run = 0; run < 2; run++) init(dest, { pkgRoot, execFileSync: vi.fn() });
    expect(PRODUCT_SCRIPTS).toContain("lessons.mjs");
    expect(fs.readFileSync(path.join(dest, SCRIPTS_REL, "lessons.mjs"), "utf8")).toBe("lessons.mjs");
    expect(fs.readFileSync(path.join(dest, ".rulesync", "skills", "review-plan", "SKILL.md"), "utf8")).toBe("review");
    expect(fs.existsSync(path.join(dest, ".rulesync", "lessons", "repo-own.md"))).toBe(false);
    expect(fs.readFileSync(path.join(dest, ".rulesync", "lessons", "mine.md"), "utf8")).toBe("consumer lesson");
    expect(RESERVED_SKILLS).toContain("review-plan");
  });

  it("omitted pkgRoot uses built-in PKG_ROOT; exec mocked", () => {
    const dest = tmp("repo-realroot-");
    const exec = vi.fn();
    init(dest, { execFileSync: exec });
    expect(fs.existsSync(path.join(dest, "AGENTS.md"))).toBe(true);
    const agents = fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8");
    const claude = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(agents.split("<!-- repo:begin -->")).toHaveLength(2);
    expect(agents.split("<!-- repo:end -->")).toHaveLength(2);
    expect(claude.split("<!-- repo:begin -->")).toHaveLength(2);
    expect(claude.split("<!-- repo:end -->")).toHaveLength(2);
    expect(fs.existsSync(path.join(dest, ".rulesync", "scripts", "scrub-text"))).toBe(true);
    expect(fs.existsSync(path.join(dest, ".rulesync", "scripts", "speak.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "scripts", "listen.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "scripts", "google-workspace.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "skills", "clasp"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "skills", "browser"))).toBe(true);
    expect(fs.existsSync(path.join(dest, ".rulesync", "reference", "listen.md"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "repo.features.jsonc"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".claude", "settings.json"))).toBe(true);
    expect(exec.mock.calls.map((c) => c[1])).toEqual([
      ["install"],
      ["run", "repo:rulesync:generate"],
      ["run", "repo:sync:globals:apply"],
      ["run", "repo:rulesync:check"],
    ]);
  });

  function writeSkill(root: string, name: string) {
    for (const dir of [".rulesync/skills", ".grok/skills", ".claude/skills", ".agents/skills"]) {
      fs.mkdirSync(path.join(root, dir, name), { recursive: true });
      fs.writeFileSync(path.join(root, dir, name, "SKILL.md"), `${name}\n`);
    }
  }

  it("copies only selected packs and drops an unselected ref instead of merging it back", () => {
    const pkgRoot = stubPkgRoot();
    writeSkill(pkgRoot, "ask");
    writeSkill(pkgRoot, "listen");
    writeSkill(pkgRoot, "speak");
    writeSkill(pkgRoot, "clasp");
    fs.mkdirSync(path.join(pkgRoot, ".rulesync", "reference"), { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, ".rulesync", "reference", "listen.md"), "# Listen\n\npack\n");
    fs.writeFileSync(path.join(pkgRoot, ".rulesync", "reference", "law.md"), "# Law\n\n## Skills naming\n\nstock\n");
    const dest = tmp("packs-default-");
    fs.mkdirSync(path.join(dest, ".rulesync", "reference"), { recursive: true });
    fs.writeFileSync(
      path.join(dest, ".rulesync", "reference", "listen.md"),
      "# Listen\n\npack\n\n## Mine\n\nkeep\n",
    );
    fs.writeFileSync(
      path.join(dest, ".rulesync", "reference", "law.md"),
      "# Law\n\n## Skills naming\n\nold\n\n## Mine\n\nkeep\n",
    );
    fs.mkdirSync(path.join(dest, ".grok", "skills", "clasp"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".grok", "skills", "clasp", "SKILL.md"), "old clasp\n");
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec });
    expect(fs.readFileSync(path.join(dest, ".rulesync", "skills", "ask", "SKILL.md"), "utf8")).toBe("ask\n");
    expect(fs.existsSync(path.join(dest, ".rulesync", "skills", "listen"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".grok", "skills", "speak"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".claude", "skills", "clasp"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".agents", "skills", "listen"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".grok", "skills", "clasp"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "scripts", "listen.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "scripts", "speak.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "reference", "listen.md"))).toBe(false);
    expect(fs.readFileSync(path.join(dest, ".rulesync", "reference", "law.md"), "utf8")).toContain("## Mine");
    expect(fs.existsSync(path.join(dest, ".rulesync", "repo.features.jsonc"))).toBe(false);

    const picked = tmp("packs-listen-");
    init(picked, { pkgRoot, execFileSync: exec, packs: ["listen"] });
    expect(fs.readFileSync(path.join(picked, ".rulesync", "skills", "listen", "SKILL.md"), "utf8")).toBe("listen\n");
    expect(fs.readFileSync(path.join(picked, ".rulesync", "scripts", "listen.mjs"), "utf8")).toBe("listen.mjs");
    expect(fs.existsSync(path.join(picked, ".rulesync", "reference", "listen.md"))).toBe(true);
    expect(fs.existsSync(path.join(picked, ".rulesync", "skills", "speak"))).toBe(false);
    expect(fs.existsSync(path.join(picked, ".rulesync", "scripts", "speak.mjs"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(picked, ".rulesync", "repo.features.jsonc"), "utf8"))).toEqual({
      packs: ["listen"],
    });

    const saved = tmp("packs-saved-");
    fs.mkdirSync(path.join(saved, ".rulesync"), { recursive: true });
    fs.writeFileSync(
      path.join(saved, ".rulesync", "repo.features.jsonc"),
      '{"packs":["speak"]}\n',
    );
    init(saved, { pkgRoot, execFileSync: exec });
    expect(fs.existsSync(path.join(saved, ".rulesync", "skills", "speak"))).toBe(true);
    expect(fs.existsSync(path.join(saved, ".rulesync", "scripts", "listen.mjs"))).toBe(false);
    expect(fs.readFileSync(path.join(saved, ".rulesync", "repo.features.jsonc"), "utf8")).toBe(
      '{"packs":["speak"]}\n',
    );

    const pkgSelf = stubPkgRoot();
    writeSkill(pkgSelf, "clasp");
    fs.writeFileSync(path.join(pkgSelf, ".rulesync", "scripts", "speak.mjs"), "keep-speak\n");
    init(pkgSelf, { pkgRoot: pkgSelf, execFileSync: exec, packs: [] });
    expect(fs.readFileSync(path.join(pkgSelf, ".rulesync", "skills", "clasp", "SKILL.md"), "utf8")).toBe("clasp\n");
    expect(fs.readFileSync(path.join(pkgSelf, ".rulesync", "scripts", "speak.mjs"), "utf8")).toBe("keep-speak\n");
    expect(fs.existsSync(path.join(pkgSelf, ".rulesync", "repo.features.jsonc"))).toBe(false);
    expect(() => init(tmp("packs-bad-"), { pkgRoot, execFileSync: exec, packs: ["nope"] })).toThrow(
      /unknown pack/,
    );
  });

  it("--skip-globals skips sync:globals:apply", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("repo-skip-globals-");
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec, skipGlobals: true });
    expect(exec.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["bun", ["install"]],
      ["bun", ["run", "repo:rulesync:generate"]],
      ["bun", ["run", "repo:rulesync:check"]],
    ]);
  });

  it("applyGlobals true still applies when sentinel auto-skip would fire", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("repo-force-globals-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- repo:begin -->\nold\n<!-- repo:end -->\n",
    );
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec, applyGlobals: true });
    expect(exec.mock.calls.map((c) => c[1])).toEqual([
      ["install"],
      ["run", "repo:rulesync:generate"],
      ["run", "repo:sync:globals:apply"],
      ["run", "repo:rulesync:check"],
    ]);
  });

  it("auto-skip globals when AGENTS.md already has a repo sentinel", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("repo-auto-sent-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- repo:begin -->\nold\n<!-- repo:end -->\n",
    );
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec });
    expect(exec.mock.calls.map((c) => c[1])).toEqual([
      ["install"],
      ["run", "repo:rulesync:generate"],
      ["run", "repo:rulesync:check"],
    ]);
  });

  it("re-run alreadyInited unmarked still merges live files; stale *.repo.md unused", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("repo-rerun-nosent-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "hand-written consumer doc\n");
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "hand-written consumer doc\n");
    fs.mkdirSync(path.join(dest, ".rulesync"), { recursive: true });
    fs.writeFileSync(path.join(dest, "CLAUDE.repo.md"), "stale side");
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec });
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n\nhand-written consumer doc\n",
    );
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nAGENTS.md content\n\n<!-- repo:end -->\n\nhand-written consumer doc\n",
    );
    expect(fs.readFileSync(path.join(dest, "CLAUDE.repo.md"), "utf8")).toBe("stale side");
    expect(fs.existsSync(path.join(dest, "AGENTS.repo.md"))).toBe(false);
  });

  it("first init without sentinel prepends repo and keeps user bottom", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("repo-first-nosent-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "hand-written consumer doc\n");
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "hand-written consumer doc\n");
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec });
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nCLAUDE.md content\n\n<!-- repo:end -->\n\nhand-written consumer doc\n",
    );
    expect(fs.existsSync(path.join(dest, "CLAUDE.repo.md"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "AGENTS.repo.md"))).toBe(false);
    expect(exec.mock.calls.map((c) => c[1])).toEqual([
      ["install"],
      ["run", "repo:rulesync:generate"],
      ["run", "repo:sync:globals:apply"],
      ["run", "repo:rulesync:check"],
    ]);
  });

  it("generate clobber after merge keeps user bottom (idempotent re-init)", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("repo-gen-clobber-");
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "consumer agents\n");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "consumer claude\n");
    fs.writeFileSync(path.join(dest, "GEMINI.md"), "consumer gemini\n");
    const exec = vi.fn((_cmd, args) => {
      if (Array.isArray(args) && args.includes("repo:rulesync:generate")) {
        fs.writeFileSync(path.join(dest, "AGENTS.md"), "generated agents\n");
        fs.writeFileSync(path.join(dest, "CLAUDE.md"), "generated claude\n");
        fs.writeFileSync(path.join(dest, "GEMINI.md"), "@AGENTS.md\n");
      }
    });
    init(dest, { pkgRoot, execFileSync: exec });
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\ngenerated agents\n\n<!-- repo:end -->\n\nconsumer agents\n",
    );
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\ngenerated claude\n\n<!-- repo:end -->\n\nconsumer claude\n",
    );
    expect(fs.readFileSync(path.join(dest, "GEMINI.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\n@AGENTS.md\n\n<!-- repo:end -->\n\nconsumer gemini\n",
    );
    init(dest, { pkgRoot, execFileSync: vi.fn() });
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- repo:begin -->\n\nAGENTS.md content\n\n<!-- repo:end -->\n\nconsumer agents\n",
    );
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8").split("consumer agents").length).toBe(
      2,
    );
  });

  it("wrapped package src + generate clobber stays begin=1 end=1", () => {
    const pkgRoot = stubPkgRoot();
    for (const f of GUARDED_MD_FILES) {
      fs.writeFileSync(
        path.join(pkgRoot, f),
        `<!-- repo:begin -->\n${f} content\n<!-- repo:end -->\n`,
      );
    }
    const dest = tmp("repo-wrap-gen-");
    const exec = vi.fn((_cmd, args) => {
      if (Array.isArray(args) && args.includes("repo:rulesync:generate")) {
        fs.writeFileSync(path.join(dest, "AGENTS.md"), "generated agents\n");
        fs.writeFileSync(path.join(dest, "CLAUDE.md"), "generated claude\n");
      }
    });
    init(dest, { pkgRoot, execFileSync: exec });
    const agents = fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8");
    const claude = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(agents).toBe("<!-- repo:begin -->\n\ngenerated agents\n\n<!-- repo:end -->\n");
    expect(claude).toBe("<!-- repo:begin -->\n\ngenerated claude\n\n<!-- repo:end -->\n");
    expect(agents.split("<!-- repo:begin -->")).toHaveLength(2);
    expect(agents.split("<!-- repo:end -->")).toHaveLength(2);
    expect(claude.split("<!-- repo:begin -->")).toHaveLength(2);
    expect(claude.split("<!-- repo:end -->")).toHaveLength(2);
  });

  it("merges dest refs into INDEX and writes .mcp.json when missing", () => {
    const dest = tmp("repo-maps-merge-");
    fs.mkdirSync(path.join(dest, ".rulesync", "reference"), { recursive: true });
    fs.writeFileSync(
      path.join(dest, ".rulesync", "reference", "stripe.md"),
      "# Stripe\n\nConsumer stripe payments ref.\n",
    );
    const exec = vi.fn();
    init(dest, { execFileSync: exec, skipGlobals: true });
    expect(GENERATED_MAP_FILES.has("INDEX.md")).toBe(true);
    const index = fs.readFileSync(path.join(dest, ".rulesync", "reference", "INDEX.md"), "utf8");
    expect(index).toMatch(/stripe\.md/);
    expect(index).toMatch(/Consumer stripe payments ref/);
    expect(index).toMatch(/browser\.md/);
    const refsMap = fs.readFileSync(path.join(dest, ".rulesync", "reference", "refs-map.md"), "utf8");
    expect(refsMap).toMatch(/stripe\.md/);
    expect(fs.existsSync(path.join(dest, ".mcp.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dest, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: {},
    });
  });

  it("keeps dest .mcp.json when already present", () => {
    const dest = tmp("repo-mcp-keep-");
    fs.writeFileSync(
      path.join(dest, ".mcp.json"),
      `${JSON.stringify({ mcpServers: { tasks: { command: "npx" } } }, null, 2)}\n`,
    );
    init(dest, { execFileSync: vi.fn(), skipGlobals: true });
    expect(JSON.parse(fs.readFileSync(path.join(dest, ".mcp.json"), "utf8"))).toEqual({
      mcpServers: { tasks: { command: "npx" } },
    });
  });

  it("throws when dest emit-maps fails", () => {
    emitMaps.mockReturnValue({ ok: false, error: "maps boom" });
    const dest = tmp("repo-maps-fail-");
    expect(() =>
      init(dest, { execFileSync: vi.fn(), skipGlobals: true }),
    ).toThrow("maps boom");
    emitMaps.mockReturnValue({ ok: false });
    const dest2 = tmp("repo-maps-fail2-");
    expect(() =>
      init(dest2, { execFileSync: vi.fn(), skipGlobals: true }),
    ).toThrow("emit-maps failed");
  });

  it("keeps extra ## sections in dest law.md and INDEX", () => {
    const dest = tmp("repo-law-extra-");
    fs.mkdirSync(path.join(dest, ".rulesync", "reference"), { recursive: true });
    const pkgLaw = fs.readFileSync(path.join(PKG_ROOT, ".rulesync", "reference", "law.md"), "utf8");
    fs.writeFileSync(
      path.join(dest, ".rulesync", "reference", "law.md"),
      `${pkgLaw.trimEnd()}\n\n## Autorun\n\npush → go-live/\n`,
    );
    init(dest, { execFileSync: vi.fn(), skipGlobals: true });
    const law = fs.readFileSync(path.join(dest, ".rulesync", "reference", "law.md"), "utf8");
    expect(law).toMatch(/## Skills naming/);
    expect(law).toMatch(/## Autorun/);
    expect(law).toMatch(/push → go-live\//);
    const index = fs.readFileSync(path.join(dest, ".rulesync", "reference", "INDEX.md"), "utf8");
    expect(index).toMatch(/## Autorun/);
    expect(index).toMatch(/push → go-live\//);
  });

  it("does not stamp package INDEX over dest; re-emits union", () => {
    const dest = tmp("repo-index-keep-");
    fs.mkdirSync(path.join(dest, ".rulesync", "reference"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".rulesync", "reference", "owned.md"), "# Owned\n\nDest-only.\n");
    fs.writeFileSync(
      path.join(dest, ".rulesync", "reference", "INDEX.md"),
      "stale repo-only index\n",
    );
    init(dest, { execFileSync: vi.fn(), skipGlobals: true });
    const index = fs.readFileSync(path.join(dest, ".rulesync", "reference", "INDEX.md"), "utf8");
    expect(index).not.toBe("stale repo-only index\n");
    expect(index).toMatch(/owned\.md/);
    expect(index).toMatch(/browser\.md/);
  });

  it("onPhase merge then bun phases stop before exec", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("repo-onphase-");
    const exec = vi.fn();
    const onPhase = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec, onPhase });
    expect(onPhase.mock.calls).toEqual([
      ["merge", "start"],
      ["merge", "stop"],
      ["install", "start"],
      ["install", "stop"],
      ["generate", "start"],
      ["generate", "stop"],
      ["sync-globals", "start"],
      ["sync-globals", "stop"],
      ["check", "start"],
      ["check", "stop"],
    ]);
    expect(exec.mock.calls.map((c) => c[1])).toEqual([
      ["install"],
      ["run", "repo:rulesync:generate"],
      ["run", "repo:sync:globals:apply"],
      ["run", "repo:rulesync:check"],
    ]);
  });

  it("self-skip only merge onPhase", () => {
    const pkgRoot = stubPkgRoot();
    const onPhase = vi.fn();
    init(pkgRoot, { pkgRoot, onPhase });
    expect(onPhase.mock.calls).toEqual([
      ["merge", "start"],
      ["merge", "stop"],
    ]);
  });

  it("warns when dest skill differs from packaged then force-overwrites; keeps extras", () => {
    const pkgRoot = stubPkgRoot();
    const pkgSkill = path.join(pkgRoot, ".rulesync", "skills", "explain");
    fs.mkdirSync(pkgSkill, { recursive: true });
    fs.writeFileSync(path.join(pkgSkill, "SKILL.md"), "repo-explain\n");
    const dest = tmp("repo-sk-conflict-");
    const destSkill = path.join(dest, ".rulesync", "skills", "explain");
    const destExtra = path.join(dest, ".rulesync", "skills", "my-extra");
    fs.mkdirSync(destSkill, { recursive: true });
    fs.mkdirSync(destExtra, { recursive: true });
    fs.writeFileSync(path.join(destSkill, "SKILL.md"), "custom-explain\n");
    fs.writeFileSync(path.join(destExtra, "SKILL.md"), "keep-me\n");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    init(dest, { pkgRoot, execFileSync: vi.fn(), skipGlobals: true });
    expect(
      warnSpy.mock.calls.some(
        (c) => String(c[0]).includes("explain") && String(c[0]).includes("re-init overwrites"),
      ),
    ).toBe(true);
    warnSpy.mockRestore();
    expect(fs.readFileSync(path.join(destSkill, "SKILL.md"), "utf8")).toBe("repo-explain\n");
    expect(fs.readFileSync(path.join(destExtra, "SKILL.md"), "utf8")).toBe("keep-me\n");
  });
});

describe("destAlreadyInited / shouldAutoSkipGlobals", () => {
  it("empty dest is neither", () => {
    const dest = tmp("inspect-empty-");
    expect(destAlreadyInited(dest)).toBe(false);
    expect(shouldAutoSkipGlobals(dest)).toBe(false);
  });

  it(".rulesync means inited, not auto-skip", () => {
    const dest = tmp("inspect-rulesync-");
    fs.mkdirSync(path.join(dest, ".rulesync"));
    expect(destAlreadyInited(dest)).toBe(true);
    expect(shouldAutoSkipGlobals(dest)).toBe(false);
  });

  it(".grok/hooks/orchestrate-parent.js means inited, not auto-skip", () => {
    const dest = tmp("inspect-hook-");
    fs.mkdirSync(path.join(dest, ".grok", "hooks"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".grok", "hooks", "orchestrate-parent.js"), "");
    expect(destAlreadyInited(dest)).toBe(true);
    expect(shouldAutoSkipGlobals(dest)).toBe(false);
  });

  it("sentinel auto-skips globals", () => {
    const dest = tmp("inspect-sent-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- repo:begin -->\nx\n<!-- repo:end -->\n",
    );
    expect(shouldAutoSkipGlobals(dest)).toBe(true);
  });
});

function spawnDest(dest: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, args, {
    cwd: dest,
    encoding: "utf8",
    env,
  });
}

const PARENT_IMPORT_RE =
  /(?:from\s+|import\s*\(\s*)["'`](\.\.[^"'`]*)["'`]/g;
const RELATIVE_IMPORT_RE =
  /(?:from\s+|import\s*\(\s*)["'`](\.[^"'`]+)["'`]/g;
const ANY_IMPORT_RE =
  /^\s*(?:import|export)\b[\w\s{},*$]*?(?:\bfrom\s*)?["'`]([^"'`]+)["'`]|\bimport\s*\(\s*["'`]([^"'`]+)["'`]/gm;

function relativeSpecs(text: string, re: RegExp) {
  const out: string[] = [];
  const copy = new RegExp(re.source, "g");
  let m: RegExpExecArray | null;
  while ((m = copy.exec(text))) out.push(m[1]);
  return out;
}

describe("product scripts are consumer-safe", () => {
  it("package.json files ships every PRODUCT_SCRIPTS entry and no tests or fixtures", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
    expect(pkg.files).toContain(".rulesync");
    expect(pkg.files).toContain("!.rulesync/scripts/**/*.test.ts");
    expect(pkg.files).toContain("!.rulesync/scripts/fixtures");
    expect(pkg.files).toContain("!.rulesync/lessons");
    for (const name of PRODUCT_SCRIPTS) {
      expect(fs.existsSync(path.join(PKG_ROOT, SCRIPTS_REL, name)), name).toBe(true);
    }
  });

  it("bin graph imports only builtins and runtime dependencies (bunx skips devDependencies)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, "package.json"), "utf8"));
    const runtime = new Set(Object.keys(pkg.dependencies ?? {}));
    const seen = new Set<string>();
    const bad: string[] = [];
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(ANY_IMPORT_RE)) {
        const spec = m[1] ?? m[2];
        if (spec.startsWith(".")) walk(path.resolve(path.dirname(file), spec));
        else if (!spec.startsWith("node:")) {
          const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
          if (!runtime.has(name)) bad.push(`${path.relative(PKG_ROOT, file)} -> ${spec}`);
        }
      }
    };
    walk(path.join(PKG_ROOT, "bin", "repo.js"));
    expect(seen.has(path.join(PKG_ROOT, ".rulesync", "scripts", "folder-map.mjs"))).toBe(true);
    expect(bad).toEqual([]);
  });

  it("do not parent-import (from or import()) — init copies .rulesync/scripts/ only", () => {
    for (const name of PRODUCT_FILES) {
      const text = fs.readFileSync(path.join(PKG_ROOT, ".rulesync", "scripts", name), "utf8");
      expect(relativeSpecs(text, PARENT_IMPORT_RE), name).toEqual([]);
    }
  });

  it("repro: dest node ./.rulesync/scripts/guarded-roots.mjs generate misses ../cli/init.mjs", () => {
    const dest = tmp("repro-cli-miss-");
    fs.mkdirSync(path.join(dest, ".rulesync", "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(dest, ".rulesync", "scripts", "broken.mjs"),
      'import { snapshotGuardedRoots } from "../../cli/init.mjs";\n',
    );
    const r = spawnDest(dest, ["./.rulesync/scripts/broken.mjs", "generate"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(r.stderr).toMatch(/cli\/init\.mjs/);
  });

  it("after init, copied scripts' relative imports exist and generate loads", () => {
    const dest = tmp("init-generate-");
    init(dest, {
      pkgRoot: PKG_ROOT,
      execFileSync: vi.fn(),
      skipGlobals: true,
      applyGlobals: false,
    });
    expect(fs.existsSync(path.join(dest, "cli"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "scripts", "guarded-roots.mjs"))).toBe(true);

    const optionalScripts = new Set(["speak.mjs", "listen.mjs", "google-workspace.mjs"]);
    for (const name of PRODUCT_FILES) {
      const file = path.join(dest, ".rulesync", "scripts", name);
      if (optionalScripts.has(name)) {
        expect(fs.existsSync(file), name).toBe(false);
        continue;
      }
      expect(fs.existsSync(file), name).toBe(true);
      const text = fs.readFileSync(file, "utf8");
      for (const spec of relativeSpecs(text, RELATIVE_IMPORT_RE)) {
        const resolved = path.resolve(path.dirname(file), spec);
        const optional = optionalScripts.has(path.basename(resolved));
        expect(fs.existsSync(resolved), `${name} -> ${spec}`).toBe(!optional);
      }
    }

    const setupRun = spawnDest(dest, ["./.rulesync/scripts/setup.mjs"], {
      ...process.env,
      CI: "1",
      PATH: ["/usr/bin", "/bin"].join(path.delimiter),
    });
    expect(`${setupRun.stdout}${setupRun.stderr}`).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(setupRun.status).toBe(1);
    expect(`${setupRun.stdout}${setupRun.stderr}`).toContain("usage: setup");

    const loaded = spawnDest(dest, ["./.rulesync/scripts/guarded-roots.mjs"]);
    expect(loaded.status).toBe(1);
    expect(loaded.stderr).toBe("usage: guarded-roots.mjs generate|check|watch\n");
    expect(loaded.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);

    const gen = spawnDest(dest, ["./.rulesync/scripts/guarded-roots.mjs", "generate"], {
      ...process.env,
      PATH: ["/usr/bin", "/bin"].join(path.delimiter),
    });
    expect(gen.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    expect(gen.stderr).not.toMatch(/cli\/init\.mjs/);
    expect(`${gen.stderr}${gen.stdout}`).toMatch(/rulesync|spawn|not found|ENOENT/i);

    for (const name of ["guarded-roots.mjs", "emit-gemini.mjs", "setup.mjs"]) {
      const r = spawnDest(dest, [
        "--input-type=module",
        "-e",
        `import(${JSON.stringify(`./.rulesync/scripts/${name}`)})`,
      ]);
      expect(r.status, `${name} load\n${r.stderr}`).toBe(0);
      expect(r.stderr, name).not.toMatch(/ERR_MODULE_NOT_FOUND/);
    }
  });
});

