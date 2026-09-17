import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_GUARDED_MARKDOWN_BYTES,
  composeGuardedMarkdown,
  destAlreadyInited,
  extractGruntBody,
  extractUserMarkdown,
  GUARDED_ROOT_FILES,
  SENTINEL_BEGIN,
  SENTINEL_END,
  guardedMarkdownDrift,
  healGuardedRootFile,
  init,
  pruneRetired,
  RETIRED_SKILLS,
  RETIRED_AGENTS,
  RETIRED_SCRIPTS,
  RETIRED_PATHS,
  RESERVED_SKILLS,
  LAUNCH_SCRIPTS,
  mergeClaudeSettings,
  mergeGitignore,
  mergeGuardedContent,
  mergeGuardedMarkdown,
  mergePackageJson,
  remergeGuardedRoots,
  samePath,
  shouldAutoSkipGlobals,
  snapshotGuardedRoots,
  toGruntScriptName,
  withGuardedCheckInteriors,
  writeMergedGuardedFile,
} from "./init.mjs";
import { runGuardedRoots } from "../scripts/guarded-roots.mjs";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

const COPY_DIRS = [".rulesync", ".grok", ".codex", ".claude", ".agents"];
const GUARDED_MD_FILES = ["AGENTS.md", "CLAUDE.md"];
const PRODUCT_FILES = [
  "check-globals.mjs",
  "emit-agent-shell-tools.mjs",
  "emit-gemini.mjs",
  "emit-maps.mjs",
  "guarded-roots.mjs",
  "emit-mcp-policy.mjs",
  "gate-fat-tools.mjs",
  "hooks-union.mjs",
  "pipeline.mjs",
  "grunt-job.mjs",
  "parse-need.mjs",
  "persist-handoff.mjs",
  "persist-implementation.mjs",
  "persist-tmp.mjs",
  "persist-plan.mjs",
  "purge-global-mcps.mjs",
  "scrub-spawn-prompt.mjs",
  "scrub-text-lib.mjs",
  "sync-global-settings.mjs",
  "browser.mjs",
  "speak.mjs",
  "listen.mjs",
  "google-workspace.mjs",
  "setup.mjs",
  "doctor.mjs",
  "skill-conflicts.mjs",
];

const SRC_CLAUDE_SETTINGS = {
  permissions: {
    deny: ["Agent(Explore)", "Agent(orchestrator)", "mcp__*"],
  },
  hooks: {
    PreToolUse: [
      {
        matcher: "spawn",
        hooks: [
          {
            type: "command",
            command: 'node "${ROOT}/scripts/scrub-spawn-prompt.mjs"',
          },
        ],
      },
      {
        matcher: "fat",
        hooks: [
          {
            type: "command",
            command: 'node "${ROOT}/scripts/gate-fat-tools.mjs"',
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
  devDependencies: {
    "smol-toml": "^1.8.0",
    rulesync: "latest",
    zzz: "1",
  },
}) {
  const root = tmp("grunt-pkg-");
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
  fs.mkdirSync(path.join(root, "scripts"));
  for (const name of PRODUCT_FILES) {
    fs.writeFileSync(path.join(root, "scripts", name), name);
  }
  fs.mkdirSync(path.join(root, "scripts", "scrub-text"));
  fs.writeFileSync(path.join(root, "scripts", "scrub-text", "inside"), "dir");
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  return root;
}

describe("samePath", () => {
  it("try: realpath equal vs unequal", () => {
    const a = tmp("same-a-");
    const b = tmp("same-b-");
    expect(samePath(a, a)).toBe(true);
    expect(samePath(a, b)).toBe(false);
  });

  it("catch: missing paths fall back to resolve", () => {
    const missing = path.join(os.tmpdir(), `grunt-missing-${process.pid}-nope`);
    expect(samePath(missing, missing)).toBe(true);
    expect(samePath(missing, `${missing}-other`)).toBe(false);
  });
});

const GI_TMP = ".tmp/\n";

describe("mergeGitignore", () => {
  it("creates .tmp/ when missing", () => {
    const dest = tmp("gi-miss-");
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(GI_TMP);
  });

  it("noop when .tmp/ already present", () => {
    const dest = tmp("gi-slash-");
    fs.writeFileSync(path.join(dest, ".gitignore"), "foo\n.tmp/\nbar\n");
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(
      "foo\n.tmp/\nbar\n",
    );
  });

  it("noop when .tmp present", () => {
    const dest = tmp("gi-bare-");
    fs.writeFileSync(path.join(dest, ".gitignore"), ".tmp\n");
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(".tmp\n");
  });

  it("noop when .tmp/ present in mixed file", () => {
    const dest = tmp("gi-both-");
    fs.writeFileSync(path.join(dest, ".gitignore"), `foo\n${GI_TMP}bar\n`);
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(
      `foo\n${GI_TMP}bar\n`,
    );
  });

  it("appends after trailing newline", () => {
    const dest = tmp("gi-nl-");
    fs.writeFileSync(path.join(dest, ".gitignore"), "node_modules/\n");
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(
      `node_modules/\n${GI_TMP}`,
    );
  });

  it("appends with inserted newline when file lacks one", () => {
    const dest = tmp("gi-nonl-");
    fs.writeFileSync(path.join(dest, ".gitignore"), "node_modules/");
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(
      `node_modules/\n${GI_TMP}`,
    );
  });

  it("appends to empty existing file", () => {
    const dest = tmp("gi-empty-");
    fs.writeFileSync(path.join(dest, ".gitignore"), "");
    mergeGitignore(dest);
    expect(fs.readFileSync(path.join(dest, ".gitignore"), "utf8")).toBe(GI_TMP);
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
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\n",
    );
  });

  it("dest exists without sentinel: prepends wrapped grunt, keeps full old body", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-nosentinel-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "hand-written consumer doc\n");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\nhand-written consumer doc\n",
    );
    expect(fs.existsSync(path.join(dest, "CLAUDE.grunt.md"))).toBe(false);
  });

  it("alreadyInited unmarked still prepends; skip is not safe", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-inited-nosent-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "hand-written consumer doc\n");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md", { alreadyInited: true });
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\nhand-written consumer doc\n",
    );
    expect(fs.existsSync(path.join(dest, "CLAUDE.grunt.md"))).toBe(false);
  });

  it("empty dest file is treated as missing", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-empty-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\n",
    );
  });

  it("dest exists with sentinel: grunt block at top, outside kept at bottom", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-sentinel-");
    fs.writeFileSync(
      path.join(dest, "CLAUDE.md"),
      "before\n<!-- grunt:begin -->\nold generated stuff\n<!-- grunt:end -->\nafter\n",
    );
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\nbefore\nafter\n",
    );
    expect(fs.existsSync(path.join(dest, "CLAUDE.grunt.md"))).toBe(false);
  });

  it("collapses duplicate sentinel pairs to one top block", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-dup-sent-");
    fs.writeFileSync(
      path.join(dest, "CLAUDE.md"),
      "<!-- grunt:begin -->\nold-a\n<!-- grunt:end -->\nkeep-a\n<!-- grunt:begin -->\nold-b\n<!-- grunt:end -->\nkeep-b\n",
    );
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    const out = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(out).toBe(
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\nkeep-a\nkeep-b\n",
    );
    expect(out.split("<!-- grunt:begin -->")).toHaveLength(2);
  });

  it("second merge is idempotent and does not double-prepend", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-idem-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "hand-written consumer doc\n");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\nhand-written consumer doc\n",
    );
  });

  it("already-guarded package src stays begin=1 end=1", () => {
    const pkgRoot = stubPkgRoot();
    fs.writeFileSync(
      path.join(pkgRoot, "CLAUDE.md"),
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\n",
    );
    const dest = tmp("md-wrapped-src-");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    const out = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(out).toBe("<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\n");
    expect(out.split("<!-- grunt:begin -->")).toHaveLength(2);
    expect(out.split("<!-- grunt:end -->")).toHaveLength(2);
  });

  it("merge heals dest with trailing orphan grunt:end", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-orphan-end-");
    fs.writeFileSync(
      path.join(dest, "CLAUDE.md"),
      "<!-- grunt:begin -->\nold\n<!-- grunt:end -->\n<!-- grunt:end -->\n",
    );
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    const out = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(out).toBe("<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\n");
    expect(out.split("<!-- grunt:end -->")).toHaveLength(2);
  });

  it("dest stacked researcher shape heals to exactly one pair", () => {
    const pkgRoot = stubPkgRoot();
    fs.writeFileSync(
      path.join(pkgRoot, "CLAUDE.md"),
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\n",
    );
    const dest = tmp("md-stacked-");
    fs.writeFileSync(
      path.join(dest, "CLAUDE.md"),
      "<!-- grunt:begin -->\n<!-- grunt:begin -->\nBODY\n<!-- grunt:end -->\n<!-- grunt:end -->\n",
    );
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    const out = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(out).toBe("<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\n");
    expect(out.split("<!-- grunt:begin -->")).toHaveLength(2);
    expect(out.split("<!-- grunt:end -->")).toHaveLength(2);
  });

  it("dest stacked keeps user prefix/suffix outside the pair", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-stacked-user-");
    fs.writeFileSync(
      path.join(dest, "CLAUDE.md"),
      "prefix\n<!-- grunt:begin -->\n<!-- grunt:begin -->\nBODY\n<!-- grunt:end -->\n<!-- grunt:end -->\nsuffix\n",
    );
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    const out = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(out).toBe(
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\nprefix\nsuffix\n",
    );
    expect(out.split("<!-- grunt:begin -->")).toHaveLength(2);
    expect(out.split("<!-- grunt:end -->")).toHaveLength(2);
  });

  it("does not fuzzy-dedupe unmarked protocol-looking user text", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-proto-");
    const user = "Voice: `.rulesync/reference/output.md` — cite once.\nspawn grunt\n";
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), user);
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      `<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\n${user}`,
    );
  });

  it("preserves CRLF from dest", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-crlf-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "user line\r\n");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\r\nCLAUDE.md content\r\n<!-- grunt:end -->\r\nuser line\r\n",
    );
  });

  it("unmarked dest equal to grunt body wraps without duplicating", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("md-equal-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "CLAUDE.md content\n");
    mergeGuardedMarkdown(dest, pkgRoot, "CLAUDE.md");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\n",
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
      "<!-- grunt:begin -->\nAGENTS.md content\n<!-- grunt:end -->\n",
    );
  });
});

describe("snapshot/remerge guarded roots", () => {
  it("remerge after clobber keeps user bottom and refreshes grunt interior", () => {
    const dest = tmp("snap-clobber-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- grunt:begin -->\nold\n<!-- grunt:end -->\nconsumer agents\n",
    );
    fs.writeFileSync(path.join(dest, "GEMINI.md"), "user gemini\n");
    const snap = snapshotGuardedRoots(dest);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "generated agents\n");
    fs.writeFileSync(path.join(dest, "GEMINI.md"), "@AGENTS.md\n");
    remergeGuardedRoots(dest, snap);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\ngenerated agents\n<!-- grunt:end -->\nconsumer agents\n",
    );
    expect(fs.readFileSync(path.join(dest, "GEMINI.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\n@AGENTS.md\n<!-- grunt:end -->\nuser gemini\n",
    );
  });

  it("remerge after wrapped-src merge+generate does not reattach orphan end", () => {
    const pkgRoot = stubPkgRoot();
    fs.writeFileSync(
      path.join(pkgRoot, "AGENTS.md"),
      "<!-- grunt:begin -->\nAGENTS.md content\n<!-- grunt:end -->\n",
    );
    const dest = tmp("snap-wrap-src-");
    mergeGuardedMarkdown(dest, pkgRoot, "AGENTS.md");
    const snap = snapshotGuardedRoots(dest);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "generated agents\n");
    remergeGuardedRoots(dest, snap);
    const out = fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8");
    expect(out).toBe("<!-- grunt:begin -->\ngenerated agents\n<!-- grunt:end -->\n");
    expect(out.split("<!-- grunt:begin -->")).toHaveLength(2);
    expect(out.split("<!-- grunt:end -->")).toHaveLength(2);
  });

  it("withGuardedCheckInteriors is restored even if check throws", () => {
    const dest = tmp("check-int-");
    const live =
      "<!-- grunt:begin -->\ngrunt body\n<!-- grunt:end -->\nuser bottom\n";
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), live);
    expect(() =>
      withGuardedCheckInteriors(dest, () => {
        expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe("grunt body\n");
        throw new Error("check failed");
      }),
    ).toThrow("check failed");
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(live);
  });

  it("compose/extract/drift/write helpers cover remaining branches", () => {
    expect(
      extractUserMarkdown(
        "<!-- grunt:begin -->\nbody\n<!-- grunt:end -->\n<!-- grunt:end -->\n",
      ),
    ).toBe("");
    expect(
      extractUserMarkdown(
        "<!-- grunt:begin -->\nbody\n<!-- grunt:end -->\nkeep\n<!-- grunt:end -->\n",
      ),
    ).toBe("keep\n");
    expect(
      composeGuardedMarkdown(
        "<!-- grunt:begin -->\nbody\n<!-- grunt:end -->\n",
        "<!-- grunt:end -->\n",
      ),
    ).toBe("<!-- grunt:begin -->\nbody\n<!-- grunt:end -->\n");
    expect(composeGuardedMarkdown("body", null)).toBe(
      "<!-- grunt:begin -->\nbody\n<!-- grunt:end -->\n",
    );
    expect(composeGuardedMarkdown("body", "\n\n")).toBe(
      "<!-- grunt:begin -->\nbody\n<!-- grunt:end -->\n",
    );
    expect(extractGruntBody("no markers")).toBeNull();
    expect(
      extractGruntBody(
        "<!-- grunt:begin -->\na\n<!-- grunt:end -->\n<!-- grunt:begin -->\nb\n<!-- grunt:end -->\n",
      ),
    ).toBe("a\nb");
    expect(mergeGuardedContent(null, "g")).toBe(
      "<!-- grunt:begin -->\ng\n<!-- grunt:end -->\n",
    );
    expect(mergeGuardedContent("", "a\r\nb")).toBe(
      "<!-- grunt:begin -->\r\na\r\nb\r\n<!-- grunt:end -->\r\n",
    );
    expect(composeGuardedMarkdown("b", "\r\n")).toBe(
      "<!-- grunt:begin -->\nb\n<!-- grunt:end -->\n",
    );
    expect(mergeGuardedContent("keep\n", "g\r\n")).toBe(
      "<!-- grunt:begin -->\ng\n<!-- grunt:end -->\nkeep\n",
    );
    expect(mergeGuardedContent("<!-- grunt:begin --> only", "g")).toBe(
      "<!-- grunt:begin -->\ng\n<!-- grunt:end -->\n",
    );
    const dest = tmp("md-helpers-");
    const missing = path.join(dest, "nope.md");
    expect(guardedMarkdownDrift(missing, "g")).toBe(true);
    writeMergedGuardedFile(missing, "g");
    expect(fs.readFileSync(missing, "utf8")).toBe(
      "<!-- grunt:begin -->\ng\n<!-- grunt:end -->\n",
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

  it("unclosed begin unwraps interior; inline orphan end is stripped", () => {
    expect(extractGruntBody("<!-- grunt:begin -->\nhello")).toBe("hello");
    const composed = composeGuardedMarkdown("<!-- grunt:begin -->\nhello", "");
    expect(composed).toBe("<!-- grunt:begin -->\nhello\n<!-- grunt:end -->\n");
    expect(composed.split(SENTINEL_BEGIN)).toHaveLength(2);
    expect(composed.split(SENTINEL_END)).toHaveLength(2);
    expect(composed).not.toContain(`${SENTINEL_BEGIN}\n${SENTINEL_BEGIN}`);
    expect(mergeGuardedContent("note\n<!-- grunt:begin -->\nstale", "new")).toBe(
      "<!-- grunt:begin -->\nnew\n<!-- grunt:end -->\nnote\n",
    );
    expect(extractUserMarkdown("keep <!-- grunt:end --> me")).not.toContain(SENTINEL_END);
    expect(extractUserMarkdown("keep <!-- grunt:end --> me")).toBe("keep  me");
    expect(extractUserMarkdown("keep\n<!-- grunt:end -->\nme")).toBe("keep\nme");
    expect(extractUserMarkdown("keep\n  <!-- grunt:end -->  \nme")).toBe("keep\nme");
    expect(extractGruntBody("<!-- grunt:begin -->\r\nhello")).toBe("hello");
    expect(extractGruntBody("<!-- grunt:begin -->")).toBe("");
    const emptyWrap = composeGuardedMarkdown("<!-- grunt:begin -->", "");
    expect(emptyWrap.split(SENTINEL_BEGIN)).toHaveLength(2);
    expect(emptyWrap).toBe("<!-- grunt:begin -->\n\n<!-- grunt:end -->\n");
    const mixed =
      "<!-- grunt:begin -->\nok\n<!-- grunt:end -->\nuser bit\n<!-- grunt:begin -->\nstale";
    expect(extractGruntBody(mixed)).toBe("ok");
    expect(extractUserMarkdown(mixed)).toBe("user bit\n");
    expect(
      composeGuardedMarkdown("<!-- grunt:begin -->\nbody\n<!-- grunt:end -->\n", ""),
    ).toBe("<!-- grunt:begin -->\nbody\n<!-- grunt:end -->\n");
  });

  it("extract/compose peel stacked dest and trailing orphan end", () => {
    const stacked =
      "<!-- grunt:begin -->\n<!-- grunt:begin -->\nBODY\n<!-- grunt:end -->\n<!-- grunt:end -->\n";
    expect(extractGruntBody(stacked)).toBe("BODY");
    const stackedOut = composeGuardedMarkdown(stacked, "");
    expect(stackedOut).toBe("<!-- grunt:begin -->\nBODY\n<!-- grunt:end -->\n");
    expect(stackedOut.split(SENTINEL_BEGIN)).toHaveLength(2);
    expect(stackedOut.split(SENTINEL_END)).toHaveLength(2);
    expect(composeGuardedMarkdown("BODY\n<!-- grunt:end -->\n", "")).toBe(
      "<!-- grunt:begin -->\nBODY\n<!-- grunt:end -->\n",
    );
    expect(extractGruntBody("BODY\n\n<!-- grunt:end -->")).toBe("BODY");
    expect(mergeGuardedContent(stacked, "SRC")).toBe(
      "<!-- grunt:begin -->\nSRC\n<!-- grunt:end -->\n",
    );
    expect(mergeGuardedContent("keep\n<!-- grunt:end -->\n", "SRC")).toBe(
      "<!-- grunt:begin -->\nSRC\n<!-- grunt:end -->\nkeep\n",
    );
    expect(
      extractGruntBody("<!-- grunt:begin --> \nBODY\n<!-- grunt:end --> \n"),
    ).toBe("BODY");
    expect(
      extractGruntBody("  <!-- grunt:begin -->\nBODY\n  <!-- grunt:end -->\n"),
    ).toBe("BODY");
    expect(extractGruntBody("<!-- grunt:begin -->\n<!-- grunt:end -->")).toBe("");
    expect(
      extractGruntBody(
        "<!-- grunt:begin -->\nsee <!-- grunt:end --> here\n<!-- grunt:end -->\n",
      ),
    ).toBe("see <!-- grunt:end --> here");
    const midLine =
      "<!-- grunt:begin -->\nBODY\n<!-- grunt:end -->\nstill user\n<!-- grunt:end -->\n";
    expect(extractGruntBody(midLine)).toBe("BODY");
    expect(extractUserMarkdown(midLine)).toBe("still user\n");
    expect(composeGuardedMarkdown(extractGruntBody(midLine) ?? "", extractUserMarkdown(midLine))).toBe(
      "<!-- grunt:begin -->\nBODY\n<!-- grunt:end -->\nstill user\n",
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
      "<!-- grunt:begin -->\n@AGENTS.md\n<!-- grunt:end -->\n",
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

  it("remerge clears user when unmarked snap equals new grunt body", () => {
    const dest = tmp("remerge-eq-");
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "same\n");
    const snap = snapshotGuardedRoots(dest);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "same\n");
    remergeGuardedRoots(dest, snap);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe("same\n");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- grunt:begin -->\nsame\n<!-- grunt:end -->\n",
    );
    remergeGuardedRoots(dest, snap);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nsame\n<!-- grunt:end -->\n",
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
      "<!-- grunt:begin -->\nold\n<!-- grunt:end -->\nkeep me\n",
    );
    const exec = vi.fn(() => {
      fs.writeFileSync(path.join(dest, "AGENTS.md"), "fresh ssot\n");
    });
    runGuardedRoots("generate", { cwd: dest, exec });
    expect(exec.mock.calls.map((c) => c[0])).toEqual([
      "rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents,skills",
      "rulesync generate -t claudecode,codexcli,antigravity-cli -f hooks",
      "node scripts/emit-mcp-policy.mjs",
      "node scripts/emit-gemini.mjs",
      "node scripts/emit-agent-shell-tools.mjs",
      "node scripts/emit-maps.mjs",
      "node scripts/hooks-union.mjs",
    ]);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nfresh ssot\n<!-- grunt:end -->\nkeep me\n",
    );
  });

  it("healGuardedRootFile rematches unmarked clobber and keeps later user edits", () => {
    const dest = tmp("heal-watch-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- grunt:begin -->\nold\n<!-- grunt:end -->\nkeep me\n",
    );
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "user claude\n");
    const snap = snapshotGuardedRoots(dest);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "watch gen 1\n");
    healGuardedRootFile(dest, "AGENTS.md", snap);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nwatch gen 1\n<!-- grunt:end -->\nkeep me\n",
    );
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- grunt:begin -->\nwatch gen 1\n<!-- grunt:end -->\nedited bottom\n",
    );
    healGuardedRootFile(dest, "AGENTS.md", snap);
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "watch gen 2\n");
    healGuardedRootFile(dest, "AGENTS.md", snap);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nwatch gen 2\n<!-- grunt:end -->\nedited bottom\n",
    );
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "watch claude\n");
    healGuardedRootFile(dest, "CLAUDE.md", snap);
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nwatch claude\n<!-- grunt:end -->\nuser claude\n",
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
      "<!-- grunt:begin -->\nsame\n<!-- grunt:end -->\n",
    );
    fs.writeFileSync(path.join(eq, "GEMINI.md"), "@AGENTS.md\n");
    healGuardedRootFile(eq, "GEMINI.md", {});
    expect(fs.readFileSync(path.join(eq, "GEMINI.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\n@AGENTS.md\n<!-- grunt:end -->\n",
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
      "<!-- grunt:begin -->\nold\n<!-- grunt:end -->\nkeep me\n",
    );
    let heal;
    const exec = vi.fn(() => {
      fs.writeFileSync(path.join(dest, "AGENTS.md"), "watch1\n");
      heal("AGENTS.md");
      expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
        "<!-- grunt:begin -->\nwatch1\n<!-- grunt:end -->\nkeep me\n",
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
      "node scripts/emit-mcp-policy.mjs",
      "node scripts/emit-gemini.mjs",
      "node scripts/emit-agent-shell-tools.mjs",
      "rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents,skills --watch",
    ]);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nwatch2\n<!-- grunt:end -->\nkeep me\n",
    );
  });

  it("runGuardedRoots watch default watchers still rematch on exit", () => {
    const dest = tmp("guarded-watch-def-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- grunt:begin -->\nold\n<!-- grunt:end -->\nkeep me\n",
    );
    const exec = vi.fn(() => {
      fs.writeFileSync(path.join(dest, "AGENTS.md"), "from-watch\n");
    });
    runGuardedRoots("watch", { cwd: dest, exec });
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nfrom-watch\n<!-- grunt:end -->\nkeep me\n",
    );
    expect(() => runGuardedRoots("nope")).toThrow(/generate\|check\|watch/);
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
                  command: 'node "${OLD_ROOT}/scripts/scrub-spawn-prompt.mjs"',
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
        { type: "command", command: 'node "${OLD_ROOT}/scripts/gate-fat-tools.mjs"' },
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
        permissions: { deny: ["Agent(Explore)", "Agent(orchestrator)"] },
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
      "Agent(orchestrator)",
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

describe("toGruntScriptName", () => {
  it("prefixes unprefixed keys and does not double-prefix", () => {
    expect(toGruntScriptName("rulesync:generate")).toBe("grunt:rulesync:generate");
    expect(toGruntScriptName("grunt:doctor")).toBe("grunt:doctor");
  });
});

describe("mergePackageJson", () => {
  it("creates {} dest and merges scripts skipping test, injects deps, sorts keys", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-new-");
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts).toEqual({
      "grunt:alpha": "a",
      "grunt:antigravity": LAUNCH_SCRIPTS.antigravity,
      "grunt:claude": LAUNCH_SCRIPTS.claude,
      "grunt:codex": LAUNCH_SCRIPTS.codex,
      "grunt:gemini": LAUNCH_SCRIPTS.gemini,
      "grunt:grok": LAUNCH_SCRIPTS.grok,
      "grunt:rulesync:generate": "gen",
      "grunt:zeta": "z",
    });
    expect(Object.keys(out.scripts)).toEqual([
      "grunt:alpha",
      "grunt:antigravity",
      "grunt:claude",
      "grunt:codex",
      "grunt:gemini",
      "grunt:grok",
      "grunt:rulesync:generate",
      "grunt:zeta",
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
    expect(out.scripts["grunt:alpha"]).toBe("a");
    expect(out.scripts["grunt:zeta"]).toBe("z");
    expect(out.scripts.foo).toBe("bar");
    expect(out.devDependencies.lodash).toBe("4");
    expect(out.devDependencies["smol-toml"]).toBe("^1.8.0");
    expect(out.devDependencies.rulesync).toBe("latest");
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("alpha") && String(c[0]).includes("untouched"))).toBe(
      true,
    );
    warnSpy.mockRestore();
  });

  it("preserves dest suffix after an upgraded grunt script prefix", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "rulesync generate -t bar" },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
    });
    const dest = tmp("pj-suffix-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: {
          "rulesync:generate": "rulesync generate -t foo && node scripts/codex-sync.mjs",
        },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["grunt:rulesync:generate"]).toBe(
      "rulesync generate -t bar && node scripts/codex-sync.mjs",
    );
    expect(out.scripts["rulesync:generate"]).toBeUndefined();
  });

  it("preserves suffix after a multi-command grunt script upgrade", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: {
        "rulesync:generate": "rulesync generate -t bar && node scripts/emit.mjs",
      },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
    });
    const dest = tmp("pj-multi-suffix-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: {
          "rulesync:generate":
            "rulesync generate -t foo && node scripts/emit.mjs && node scripts/codex-sync.mjs",
        },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["grunt:rulesync:generate"]).toBe(
      "rulesync generate -t bar && node scripts/emit.mjs && node scripts/codex-sync.mjs",
    );
  });

  it("does not treat a non-owned prefix plus extra && as a grunt suffix", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { alpha: "a" },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
    });
    const dest = tmp("pj-nonowned-suffix-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ scripts: { alpha: "echo custom && extra" } }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts.alpha).toBe("echo custom && extra");
    expect(out.scripts["grunt:alpha"]).toBe("a");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls through suffix scan when extra commands use bare semicolons", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "rulesync generate -t bar" },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
    });
    const dest = tmp("pj-semi-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: { "rulesync:generate": "echo custom;echo extra" },
      }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["rulesync:generate"]).toBe("echo custom;echo extra");
    expect(out.scripts["grunt:rulesync:generate"]).toBe("rulesync generate -t bar");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("keeps dest when dest script already equals src", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "rulesync generate -t bar" },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
    });
    const dest = tmp("pj-equal-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ scripts: { "rulesync:generate": "rulesync generate -t bar" } }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["grunt:rulesync:generate"]).toBe("rulesync generate -t bar");
    expect(out.scripts["rulesync:generate"]).toBeUndefined();
  });

  it("keeps dest when it already starts with the new src value plus suffix", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "rulesync generate -t bar" },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
    });
    const dest = tmp("pj-prefix-");
    const cur = "rulesync generate -t bar && node scripts/codex-sync.mjs";
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ scripts: { "rulesync:generate": cur } }));
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["grunt:rulesync:generate"]).toBe(cur);
    expect(out.scripts["rulesync:generate"]).toBeUndefined();
  });

  it("keeps unrelated custom script values and dest-only keys, warns on skip", () => {
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
    expect(out.scripts["grunt:alpha"]).toBe("a");
    expect(out.scripts.foo).toBe("bar");
    expect(out.scripts.test).toBe("jest");
    expect(out.scripts["grunt:zeta"]).toBe("z");
    expect(out.scripts.zeta).toBeUndefined();
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("alpha") && String(c[0]).includes("untouched"))).toBe(
      true,
    );
    warnSpy.mockRestore();
  });

  it("does not merge :raw scripts from src", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: {
        "rulesync:generate": "node ./scripts/guarded-roots.mjs generate",
        "rulesync:generate:raw": "echo raw",
        "rulesync:check:raw": "echo check-raw",
        "rulesync:watch:raw": "echo watch-raw",
      },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
    });
    const dest = tmp("pj-raw-src-");
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["grunt:rulesync:generate"]).toBe("node ./scripts/guarded-roots.mjs generate");
    expect(out.scripts["rulesync:generate"]).toBeUndefined();
    expect(out.scripts["rulesync:generate:raw"]).toBeUndefined();
    expect(out.scripts["rulesync:check:raw"]).toBeUndefined();
    expect(out.scripts["rulesync:watch:raw"]).toBeUndefined();
  });

  it("leaves dest-only :raw keys", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "node ./scripts/guarded-roots.mjs generate" },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
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
    expect(out.scripts["grunt:rulesync:generate"]).toBe("node ./scripts/guarded-roots.mjs generate");
    expect(out.scripts["rulesync:generate:raw"]).toBe("echo consumer-raw");
  });

  it("replaces a grunt-owned script with no suffix", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "rulesync generate -t bar", "sync:globals:apply": "node scripts/sync-global-settings.mjs --apply" },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
    });
    const dest = tmp("pj-owned-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: { "rulesync:generate": "rulesync generate -t foo" },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["grunt:rulesync:generate"]).toBe("rulesync generate -t bar");
    expect(out.scripts["grunt:sync:globals:apply"]).toBe("node scripts/sync-global-settings.mjs --apply");
    expect(out.scripts["rulesync:generate"]).toBeUndefined();
  });

  it("early return when name is @lovrozagar/grunt", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-self-");
    const raw = `${JSON.stringify({ name: "@lovrozagar/grunt", scripts: { test: "x" } }, null, 2)}\n`;
    fs.writeFileSync(path.join(dest, "package.json"), raw);
    mergePackageJson(dest, pkgRoot);
    expect(fs.readFileSync(path.join(dest, "package.json"), "utf8")).toBe(raw);
  });

  it("src without scripts uses empty object", () => {
    const pkgRoot = stubPkgRoot({
      name: "no-scripts",
      devDependencies: { "smol-toml": "1", rulesync: "2" },
    });
    const dest = tmp("pj-noscripts-");
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts).toEqual({
      "grunt:antigravity": LAUNCH_SCRIPTS.antigravity,
      "grunt:claude": LAUNCH_SCRIPTS.claude,
      "grunt:codex": LAUNCH_SCRIPTS.codex,
      "grunt:gemini": LAUNCH_SCRIPTS.gemini,
      "grunt:grok": LAUNCH_SCRIPTS.grok,
    });
    expect(out.devDependencies).toEqual({ rulesync: "2", "smol-toml": "1" });
  });

  it("golden autorun-apps: suffix keep, doctor move, check npm run rewrite, old keys gone", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: {
        "rulesync:generate": "node ./scripts/guarded-roots.mjs generate",
        "rulesync:watch": "node ./scripts/guarded-roots.mjs watch",
        "rulesync:check": "node ./scripts/guarded-roots.mjs check",
        "hooks:union": "node scripts/hooks-union.mjs",
        "hooks:check": "node scripts/hooks-union.mjs --check",
        doctor: "node ./scripts/doctor.mjs",
        "rulesync:doctor": "rulesync doctor",
        "sync:globals": "node scripts/sync-global-settings.mjs",
        "sync:globals:check": "node scripts/check-globals.mjs",
        "sync:globals:apply": "node scripts/sync-global-settings.mjs --apply",
        "purge:global-mcps": "node scripts/purge-global-mcps.mjs",
        "purge:global-mcps:apply": "node scripts/purge-global-mcps.mjs --apply",
        test: "vitest run --coverage",
      },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
    });
    const dest = tmp("pj-autorun-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: {
          "apps:doctor": "node scripts/audit.mjs",
          "apps:mental-model:viewer:build":
            "npm --prefix scripts/excalidraw/viewer install && npm --prefix scripts/excalidraw/viewer run build",
          check:
            "node scripts/portability-check.mjs && npm run rulesync:check && npm run lint && npm test && node scripts/media-fixtures.mjs --check",
          "codex:sync": "node scripts/codex-sync.mjs",
          doctor: "node ./scripts/doctor.mjs",
          "hooks:check": "node scripts/hooks-union.mjs --check",
          "hooks:union": "node scripts/hooks-union.mjs",
          lint: "eslint scripts tests eslint.config.mjs",
          "purge:global-mcps": "node scripts/purge-global-mcps.mjs",
          "purge:global-mcps:apply": "node scripts/purge-global-mcps.mjs --apply",
          "rulesync:check": "node ./scripts/guarded-roots.mjs check && node scripts/codex-sync.mjs --check",
          "rulesync:doctor": "rulesync doctor",
          "rulesync:generate": "node ./scripts/guarded-roots.mjs generate && node scripts/codex-sync.mjs",
          "rulesync:watch": "node ./scripts/guarded-roots.mjs watch",
          "sync:globals": "node scripts/sync-global-settings.mjs",
          "sync:globals:apply": "node scripts/sync-global-settings.mjs --apply",
          "sync:globals:check": "node scripts/check-globals.mjs",
          test: "node scripts/run-tests.mjs",
        },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["grunt:rulesync:generate"]).toBe(
      "node ./scripts/guarded-roots.mjs generate && node scripts/codex-sync.mjs",
    );
    expect(out.scripts["grunt:rulesync:check"]).toBe(
      "node ./scripts/guarded-roots.mjs check && node scripts/codex-sync.mjs --check",
    );
    expect(out.scripts["grunt:rulesync:watch"]).toBe("node ./scripts/guarded-roots.mjs watch");
    expect(out.scripts["grunt:rulesync:doctor"]).toBe("rulesync doctor");
    expect(out.scripts["grunt:hooks:union"]).toBe("node scripts/hooks-union.mjs");
    expect(out.scripts["grunt:hooks:check"]).toBe("node scripts/hooks-union.mjs --check");
    expect(out.scripts["grunt:sync:globals"]).toBe("node scripts/sync-global-settings.mjs");
    expect(out.scripts["grunt:sync:globals:apply"]).toBe("node scripts/sync-global-settings.mjs --apply");
    expect(out.scripts["grunt:sync:globals:check"]).toBe("node scripts/check-globals.mjs");
    expect(out.scripts["grunt:purge:global-mcps"]).toBe("node scripts/purge-global-mcps.mjs");
    expect(out.scripts["grunt:purge:global-mcps:apply"]).toBe("node scripts/purge-global-mcps.mjs --apply");
    expect(out.scripts["grunt:doctor"]).toBe("node ./scripts/doctor.mjs");
    expect(out.scripts.doctor).toBeUndefined();
    expect(out.scripts["rulesync:generate"]).toBeUndefined();
    expect(out.scripts["rulesync:check"]).toBeUndefined();
    expect(out.scripts["rulesync:watch"]).toBeUndefined();
    expect(out.scripts["hooks:union"]).toBeUndefined();
    expect(out.scripts["sync:globals"]).toBeUndefined();
    expect(out.scripts.check).toBe(
      "node scripts/portability-check.mjs && npm run grunt:rulesync:check && npm run lint && npm test && node scripts/media-fixtures.mjs --check",
    );
    expect(out.scripts["apps:doctor"]).toBe("node scripts/audit.mjs");
    expect(out.scripts["codex:sync"]).toBe("node scripts/codex-sync.mjs");
    expect(out.scripts.lint).toBe("eslint scripts tests eslint.config.mjs");
    expect(out.scripts.test).toBe("node scripts/run-tests.mjs");
  });

  it("leaves custom doctor and writes grunt:doctor from SoT", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { doctor: "node ./scripts/doctor.mjs" },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
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
    expect(out.scripts["grunt:doctor"]).toBe("node ./scripts/doctor.mjs");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("merges destKey when both prefixed and owned legacy exist, deletes legacy", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:generate": "rulesync generate -t bar" },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
    });
    const dest = tmp("pj-both-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: {
          "rulesync:generate": "rulesync generate -t foo && node scripts/codex-sync.mjs",
          "grunt:rulesync:generate": "rulesync generate -t old && node scripts/other.mjs",
        },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["grunt:rulesync:generate"]).toBe(
      "rulesync generate -t bar && node scripts/other.mjs",
    );
    expect(out.scripts["rulesync:generate"]).toBeUndefined();
  });

  it("does not rewrite npm run rulesync:check:raw when only rulesync:check migrated", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:check": "node ./scripts/guarded-roots.mjs check" },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
    });
    const dest = tmp("pj-raw-rewrite-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: {
          "rulesync:check": "node ./scripts/guarded-roots.mjs check",
          "rulesync:check:raw": "echo consumer-raw",
          check: "npm run rulesync:check && npm run rulesync:check:raw",
        },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["grunt:rulesync:check"]).toBe("node ./scripts/guarded-roots.mjs check");
    expect(out.scripts["rulesync:check"]).toBeUndefined();
    expect(out.scripts["rulesync:check:raw"]).toBe("echo consumer-raw");
    expect(out.scripts.check).toBe("npm run grunt:rulesync:check && npm run rulesync:check:raw");
  });

  it("skips non-string dest scripts when rewriting npm run refs", () => {
    const pkgRoot = stubPkgRoot({
      name: "fixture-pkg",
      scripts: { "rulesync:check": "node ./scripts/guarded-roots.mjs check" },
      devDependencies: { "smol-toml": "^1.8.0", rulesync: "latest" },
    });
    const dest = tmp("pj-nonstr-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: {
          extra: 1,
          check: "npm run rulesync:check",
        },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts.extra).toBe(1);
    expect(out.scripts.check).toBe("npm run grunt:rulesync:check");
    expect(out.scripts["grunt:rulesync:check"]).toBe("node ./scripts/guarded-roots.mjs check");
  });

  it("emits grunt:claude into a consumer package.json", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-launch-emit-");
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["grunt:claude"]).toBe(LAUNCH_SCRIPTS.claude);
  });

  it("leaves a consumer's bare claude launcher untouched, no warn emitted", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-consumer-claude-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ scripts: { claude: "npm run build && claude" } }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts.claude).toBe("npm run build && claude");
    expect(out.scripts["grunt:claude"]).toBe(LAUNCH_SCRIPTS.claude);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("does not rewrite npm run claude inside a consumer script", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-npmrun-claude-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: { claude: "npm run build && claude", start: "npm run claude" },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts.start).toBe("npm run claude");
  });

  it("purges a stale grunt:yolo:claude with the exact old value; an edited variant survives", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("pj-purge-stale-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        scripts: {
          "grunt:yolo:claude": LAUNCH_SCRIPTS.claude,
          "grunt:yolo:codex": `${LAUNCH_SCRIPTS.codex} --extra`,
        },
      }),
    );
    mergePackageJson(dest, pkgRoot);
    const out = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(out.scripts["grunt:yolo:claude"]).toBeUndefined();
    expect(out.scripts["grunt:claude"]).toBe(LAUNCH_SCRIPTS.claude);
    expect(out.scripts["grunt:yolo:codex"]).toBe(`${LAUNCH_SCRIPTS.codex} --extra`);
  });

  it("drift: every bare launcher key in grunt's package.json equals LAUNCH_SCRIPTS[key]", () => {
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
    expect(fs.readFileSync(path.join(pkgRoot, ".gitignore"), "utf8")).toBe(".tmp/\n");
    expect(fs.readFileSync(path.join(pkgRoot, "scripts", "grunt-job.mjs"), "utf8")).toBe(
      "grunt-job.mjs",
    );
    // self-skip: markdown/settings stay exactly as-is, no sentinel wrap
    expect(fs.readFileSync(path.join(pkgRoot, "CLAUDE.md"), "utf8")).toBe("CLAUDE.md content");
    const settings = JSON.parse(
      fs.readFileSync(path.join(pkgRoot, ".claude", "settings.json"), "utf8"),
    );
    expect(settings).toEqual(SRC_CLAUDE_SETTINGS);
  });

  it("non-self: file vs dir product scripts, guarded md + settings merge, then npm pipeline in order", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("grunt-dest-");
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec });

    for (const d of COPY_DIRS) {
      if (d === ".claude") continue;
      expect(fs.readFileSync(path.join(dest, d, "marker"), "utf8")).toBe(d);
    }
    expect(fs.existsSync(path.join(dest, ".rulesync", "grunt.config.jsonc"))).toBe(false);
    expect(PRODUCT_FILES).not.toContain("grunt-config.mjs");
    expect(fs.existsSync(path.join(dest, "scripts", "grunt-config.mjs"))).toBe(false);
    expect(fs.readFileSync(path.join(dest, ".claude", "marker"), "utf8")).toBe(".claude");
    const settings = JSON.parse(
      fs.readFileSync(path.join(dest, ".claude", "settings.json"), "utf8"),
    );
    expect(settings).toEqual(SRC_CLAUDE_SETTINGS);

    for (const f of GUARDED_MD_FILES) {
      expect(fs.readFileSync(path.join(dest, f), "utf8")).toBe(
        `<!-- grunt:begin -->\n${f} content\n<!-- grunt:end -->\n`,
      );
    }
    expect(fs.existsSync(path.join(dest, ".mcp.json"))).toBe(false);

    for (const name of PRODUCT_FILES) {
      expect(fs.statSync(path.join(dest, "scripts", name)).isFile()).toBe(true);
    }
    expect(fs.statSync(path.join(dest, "scripts", "scrub-text")).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(dest, "scripts", "scrub-text", "inside"), "utf8")).toBe(
      "dir",
    );

    const destPkg = JSON.parse(fs.readFileSync(path.join(dest, "package.json"), "utf8"));
    expect(destPkg.scripts.test).toBeUndefined();
    expect(destPkg.devDependencies["smol-toml"]).toBe("^1.8.0");

    expect(exec.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["npm", ["install"]],
      ["npm", ["run", "grunt:rulesync:generate"]],
      ["npm", ["run", "grunt:sync:globals:apply"]],
      ["npm", ["run", "grunt:rulesync:check"]],
    ]);
    for (const call of exec.mock.calls) {
      expect(call[2]).toEqual({ cwd: dest, stdio: "inherit" });
    }
  });

  it("re-running init on an already-initialized dest merges settings.json instead of clobbering", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("grunt-rerun-");
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

  it("omitted execFileSync uses default; self-skip never invokes it", () => {
    const pkgRoot = stubPkgRoot();
    init(pkgRoot, { pkgRoot });
    expect(fs.existsSync(path.join(pkgRoot, "AGENTS.md"))).toBe(true);
    expect(fs.readFileSync(path.join(pkgRoot, ".gitignore"), "utf8")).toBe(".tmp/\n");
  });

  it("prunes retired 0.5 skills and agents on dest", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("grunt-prune-");
    fs.mkdirSync(path.join(dest, ".rulesync", "skills", "solo"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".rulesync", "skills", "solo", "SKILL.md"), "old");
    fs.mkdirSync(path.join(dest, ".rulesync", "skills", "parent"), { recursive: true });
    fs.mkdirSync(path.join(dest, ".rulesync", "skills", "cascade"), { recursive: true });
    fs.mkdirSync(path.join(dest, ".claude", "agents"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".claude", "agents", "implementer.md"), "old");
    fs.writeFileSync(path.join(dest, ".claude", "agents", "thinker.md"), "old");
    expect(RETIRED_SKILLS).toEqual(["parent", "solo", "cascade"]);
    expect(RETIRED_AGENTS).toEqual(["implementer", "thinker"]);
    expect(RETIRED_SCRIPTS).toEqual(["telemetry.mjs", "grunt-config.mjs"]);
    expect(RETIRED_PATHS).toEqual([
      ".grok/parent.md",
      ".grok/skills/shared",
      ".rulesync/grunt.config.jsonc",
      ".rulesync/grunt.config.local.jsonc",
      ".rulesync/grunt.config.local.jsonc.example",
    ]);
    expect(RESERVED_SKILLS).toEqual([
      "ask",
      "auto",
      "browser",
      "clasp",
      "commit",
      "commit-and-push",
      "commit-push",
      "commit-push-deploy",
      "commit-push-release",
      "explain",
      "google-workspace",
      "handoff",
      "implement-plan",
      "listen",
      "pickup",
      "speak",
      "tmp",
      "write-plan",
    ]);
    expect(RESERVED_SKILLS).not.toEqual(expect.arrayContaining(RETIRED_SKILLS));
    init(dest, { pkgRoot, execFileSync: vi.fn() });
    expect(fs.existsSync(path.join(dest, ".rulesync", "skills", "solo"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "skills", "parent"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "skills", "cascade"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".claude", "agents", "implementer.md"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(dest, ".claude", "agents", "thinker.md"))).toBe(false);
    pruneRetired(dest, { pkgRoot });
  });

  it("prunes retired scripts/paths, reserved-not-packaged skills, and grok roles; keeps consumer extras", () => {
    const pkgRoot = stubPkgRoot();
    fs.mkdirSync(path.join(pkgRoot, ".rulesync", "skills", "tmp"), { recursive: true });
    fs.writeFileSync(path.join(pkgRoot, ".rulesync", "skills", "tmp", "SKILL.md"), "pkg tmp");
    const dest = tmp("grunt-prune-extra-");
    fs.mkdirSync(path.join(dest, ".rulesync", "skills", "tmp"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".rulesync", "skills", "tmp", "SKILL.md"), "old tmp");
    fs.mkdirSync(path.join(dest, ".rulesync", "skills", "browser"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".rulesync", "skills", "browser", "SKILL.md"), "stale reserved");
    fs.mkdirSync(path.join(dest, ".rulesync", "skills", "acme"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".rulesync", "skills", "acme", "SKILL.md"), "consumer");
    fs.mkdirSync(path.join(dest, ".grok", "roles"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".grok", "roles", "implementer.toml"), "old");
    fs.writeFileSync(path.join(dest, ".grok", "roles", "thinker.toml"), "old");
    fs.writeFileSync(path.join(dest, ".grok", "parent.md"), "pointer");
    fs.mkdirSync(path.join(dest, ".grok", "skills", "shared"), { recursive: true });
    fs.mkdirSync(path.join(dest, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dest, "scripts", "telemetry.mjs"), "old telemetry");
    fs.writeFileSync(path.join(dest, "scripts", "grunt-config.mjs"), "old config");
    fs.writeFileSync(path.join(dest, "scripts", "mine.mjs"), "keep");
    fs.writeFileSync(path.join(dest, ".rulesync", "grunt.config.jsonc"), '{"version":1}\n');
    fs.writeFileSync(path.join(dest, ".rulesync", "grunt.config.local.jsonc"), '{"sessionGate":"ask"}\n');
    fs.writeFileSync(
      path.join(dest, ".rulesync", "grunt.config.local.jsonc.example"),
      '{"sessionGate":"ask"}\n',
    );
    fs.mkdirSync(path.join(dest, ".gemini", "agents", "implementer"), { recursive: true });
    fs.writeFileSync(path.join(dest, ".gemini", "agents", "implementer", "agent.md"), "old");
    init(dest, { pkgRoot, execFileSync: vi.fn() });
    expect(fs.readFileSync(path.join(dest, ".rulesync", "skills", "tmp", "SKILL.md"), "utf8")).toBe(
      "pkg tmp",
    );
    expect(fs.existsSync(path.join(dest, ".rulesync", "skills", "browser"))).toBe(false);
    expect(fs.readFileSync(path.join(dest, ".rulesync", "skills", "acme", "SKILL.md"), "utf8")).toBe(
      "consumer",
    );
    expect(fs.existsSync(path.join(dest, ".grok", "roles", "implementer.toml"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".grok", "roles", "thinker.toml"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".grok", "parent.md"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".grok", "skills", "shared"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "scripts", "telemetry.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "scripts", "grunt-config.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "grunt.config.jsonc"))).toBe(false);
    expect(fs.existsSync(path.join(dest, ".rulesync", "grunt.config.local.jsonc"))).toBe(false);
    expect(
      fs.existsSync(path.join(dest, ".rulesync", "grunt.config.local.jsonc.example")),
    ).toBe(false);
    expect(fs.readFileSync(path.join(dest, "scripts", "mine.mjs"), "utf8")).toBe("keep");
    expect(fs.existsSync(path.join(dest, ".gemini", "agents", "implementer"))).toBe(false);
  });

  it("omitted pkgRoot uses built-in PKG_ROOT; exec mocked", () => {
    const dest = tmp("grunt-realroot-");
    const exec = vi.fn();
    init(dest, { execFileSync: exec });
    expect(fs.existsSync(path.join(dest, "AGENTS.md"))).toBe(true);
    const agents = fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8");
    const claude = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(agents.split("<!-- grunt:begin -->")).toHaveLength(2);
    expect(agents.split("<!-- grunt:end -->")).toHaveLength(2);
    expect(claude.split("<!-- grunt:begin -->")).toHaveLength(2);
    expect(claude.split("<!-- grunt:end -->")).toHaveLength(2);
    expect(fs.existsSync(path.join(dest, "scripts", "scrub-text"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "scripts", "grunt-config.mjs"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "scripts", "speak.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "scripts", "listen.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dest, "scripts", "google-workspace.mjs"))).toBe(true);
    expect(fs.existsSync(path.join(dest, ".claude", "settings.json"))).toBe(true);
    expect(fs.existsSync(path.join(dest, ".rulesync", "grunt.config.jsonc"))).toBe(false);
    expect(exec.mock.calls.map((c) => c[1])).toEqual([
      ["install"],
      ["run", "grunt:rulesync:generate"],
      ["run", "grunt:sync:globals:apply"],
      ["run", "grunt:rulesync:check"],
    ]);
  });

  it("--skip-globals skips sync:globals:apply", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("grunt-skip-globals-");
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec, skipGlobals: true });
    expect(exec.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["npm", ["install"]],
      ["npm", ["run", "grunt:rulesync:generate"]],
      ["npm", ["run", "grunt:rulesync:check"]],
    ]);
  });

  it("applyGlobals true still applies when sentinel auto-skip would fire", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("grunt-force-globals-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- grunt:begin -->\nold\n<!-- grunt:end -->\n",
    );
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec, applyGlobals: true });
    expect(exec.mock.calls.map((c) => c[1])).toEqual([
      ["install"],
      ["run", "grunt:rulesync:generate"],
      ["run", "grunt:sync:globals:apply"],
      ["run", "grunt:rulesync:check"],
    ]);
  });

  it("auto-skip globals when AGENTS.md already has a grunt sentinel", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("grunt-auto-sent-");
    fs.writeFileSync(
      path.join(dest, "AGENTS.md"),
      "<!-- grunt:begin -->\nold\n<!-- grunt:end -->\n",
    );
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec });
    expect(exec.mock.calls.map((c) => c[1])).toEqual([
      ["install"],
      ["run", "grunt:rulesync:generate"],
      ["run", "grunt:rulesync:check"],
    ]);
  });

  it("re-run alreadyInited unmarked still merges live files; stale *.grunt.md unused", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("grunt-rerun-nosent-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "hand-written consumer doc\n");
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "hand-written consumer doc\n");
    fs.mkdirSync(path.join(dest, ".rulesync"), { recursive: true });
    fs.writeFileSync(path.join(dest, "CLAUDE.grunt.md"), "stale side");
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec });
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\nhand-written consumer doc\n",
    );
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nAGENTS.md content\n<!-- grunt:end -->\nhand-written consumer doc\n",
    );
    expect(fs.readFileSync(path.join(dest, "CLAUDE.grunt.md"), "utf8")).toBe("stale side");
    expect(fs.existsSync(path.join(dest, "AGENTS.grunt.md"))).toBe(false);
  });

  it("first init without sentinel prepends grunt and keeps user bottom", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("grunt-first-nosent-");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "hand-written consumer doc\n");
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "hand-written consumer doc\n");
    const exec = vi.fn();
    init(dest, { pkgRoot, execFileSync: exec });
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nCLAUDE.md content\n<!-- grunt:end -->\nhand-written consumer doc\n",
    );
    expect(fs.existsSync(path.join(dest, "CLAUDE.grunt.md"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "AGENTS.grunt.md"))).toBe(false);
    expect(exec.mock.calls.map((c) => c[1])).toEqual([
      ["install"],
      ["run", "grunt:rulesync:generate"],
      ["run", "grunt:sync:globals:apply"],
      ["run", "grunt:rulesync:check"],
    ]);
  });

  it("generate clobber after merge keeps user bottom (idempotent re-init)", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("grunt-gen-clobber-");
    fs.writeFileSync(path.join(dest, "AGENTS.md"), "consumer agents\n");
    fs.writeFileSync(path.join(dest, "CLAUDE.md"), "consumer claude\n");
    fs.writeFileSync(path.join(dest, "GEMINI.md"), "consumer gemini\n");
    const exec = vi.fn((_cmd, args) => {
      if (Array.isArray(args) && args.includes("grunt:rulesync:generate")) {
        fs.writeFileSync(path.join(dest, "AGENTS.md"), "generated agents\n");
        fs.writeFileSync(path.join(dest, "CLAUDE.md"), "generated claude\n");
        fs.writeFileSync(path.join(dest, "GEMINI.md"), "@AGENTS.md\n");
      }
    });
    init(dest, { pkgRoot, execFileSync: exec });
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\ngenerated agents\n<!-- grunt:end -->\nconsumer agents\n",
    );
    expect(fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\ngenerated claude\n<!-- grunt:end -->\nconsumer claude\n",
    );
    expect(fs.readFileSync(path.join(dest, "GEMINI.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\n@AGENTS.md\n<!-- grunt:end -->\nconsumer gemini\n",
    );
    init(dest, { pkgRoot, execFileSync: vi.fn() });
    expect(fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8")).toBe(
      "<!-- grunt:begin -->\nAGENTS.md content\n<!-- grunt:end -->\nconsumer agents\n",
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
        `<!-- grunt:begin -->\n${f} content\n<!-- grunt:end -->\n`,
      );
    }
    const dest = tmp("grunt-wrap-gen-");
    const exec = vi.fn((_cmd, args) => {
      if (Array.isArray(args) && args.includes("grunt:rulesync:generate")) {
        fs.writeFileSync(path.join(dest, "AGENTS.md"), "generated agents\n");
        fs.writeFileSync(path.join(dest, "CLAUDE.md"), "generated claude\n");
      }
    });
    init(dest, { pkgRoot, execFileSync: exec });
    const agents = fs.readFileSync(path.join(dest, "AGENTS.md"), "utf8");
    const claude = fs.readFileSync(path.join(dest, "CLAUDE.md"), "utf8");
    expect(agents).toBe("<!-- grunt:begin -->\ngenerated agents\n<!-- grunt:end -->\n");
    expect(claude).toBe("<!-- grunt:begin -->\ngenerated claude\n<!-- grunt:end -->\n");
    expect(agents.split("<!-- grunt:begin -->")).toHaveLength(2);
    expect(agents.split("<!-- grunt:end -->")).toHaveLength(2);
    expect(claude.split("<!-- grunt:begin -->")).toHaveLength(2);
    expect(claude.split("<!-- grunt:end -->")).toHaveLength(2);
  });

  it("onPhase merge then npm phases stop before exec", () => {
    const pkgRoot = stubPkgRoot();
    const dest = tmp("grunt-onphase-");
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
      ["run", "grunt:rulesync:generate"],
      ["run", "grunt:sync:globals:apply"],
      ["run", "grunt:rulesync:check"],
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
    fs.writeFileSync(path.join(pkgSkill, "SKILL.md"), "grunt-explain\n");
    const dest = tmp("grunt-sk-conflict-");
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
    expect(fs.readFileSync(path.join(destSkill, "SKILL.md"), "utf8")).toBe("grunt-explain\n");
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
      "<!-- grunt:begin -->\nx\n<!-- grunt:end -->\n",
    );
    expect(shouldAutoSkipGlobals(dest)).toBe(true);
  });
});

