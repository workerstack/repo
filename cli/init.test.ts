import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { aliasOf } from "../dev/test-paths";
import { HOSTS, SKILL_PACKS } from "./config.ts";
import { BASE_CONFIG } from "./fixtures/base-config.ts";
import {
  PACKAGE_NAME,
  type InitOptions,
  init,
  mergePackageJson,
  parsePacksFlag,
  placeDevDependency,
  samePath,
  writeConfigIfMissing,
} from "./init.ts";
import { standards } from "./sync/standards.ts";

/** A resolved config's agents with no host and no skill. */
const NO_AGENTS = { hosts: [], skills: [] };

const PKG_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { force: true, recursive: true });
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

type PackageJson = {
  name?: string;
  version?: string;
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
};

function readPkg(dir: string): PackageJson {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as PackageJson;
}

/** A fake installed package: only its package.json matters to init. */
function stubPkgRoot(pkg: Record<string, unknown> = { name: "fixture-pkg", version: "1.2.3" }) {
  const root = tmp("repo-pkg-");
  fs.writeFileSync(path.join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  return root;
}

const HOSTS_LIST = HOSTS.map((h) => JSON.stringify(h)).join(", ");
const config = (body: string) =>
  `import { defineConfig } from "@workerstack/repo";\n\nexport default defineConfig({\n${body}});\n`;
const PACKS_LINE = `  packs: ["agents", "standards", "docs"],\n`;
const DEFAULT_BODY = `${PACKS_LINE}  agents: { hosts: [${HOSTS_LIST}] },\n`;

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

describe("parsePacksFlag", () => {
  it("lists the packs once each in pack order; none and empty are no packs", () => {
    expect(parsePacksFlag("speak,listen")).toEqual(["listen", "speak"]);
    expect(parsePacksFlag(" clasp , google-workspace,clasp ")).toEqual(["google-workspace", "clasp"]);
    expect(parsePacksFlag("none")).toEqual([]);
    expect(parsePacksFlag("")).toEqual([]);
  });

  it("refuses a name that is not a pack", () => {
    expect(() => parsePacksFlag("listen,nope")).toThrow("unknown pack nope");
  });
});

describe("mergePackageJson", () => {
  it("writes the postinstall and the devDependency, and no repo: script or helper dependency", () => {
    const dest = tmp("pj-new-");
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, scripts: { alpha: "a" }, version: "0.7.0" }));
    expect(readPkg(dest)).toEqual({
      devDependencies: { [PACKAGE_NAME]: "0.7.0" },
      packageManager: `bun@${Bun.version}`,
      private: true,
      scripts: { postinstall: "repo sync --postinstall" },
      sideEffects: false,
    });
  });

  it("writes private, sideEffects and packageManager on the root only when they are absent", () => {
    const dest = tmp("pj-keys-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ name: "app", packageManager: "bun@^1.4", private: false, sideEffects: ["*.css"] }),
    );
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
    const out = readPkg(dest);
    expect(out).toMatchObject({ packageManager: "bun@^1.4", private: false, sideEffects: ["*.css"] });
  });

  it("leaves sideEffects off a root that has workspaces", () => {
    const dest = tmp("pj-keys-mono-");
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "mono", workspaces: ["packages/*"] }));
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
    const out = readPkg(dest);
    expect(out).toMatchObject({ packageManager: `bun@${Bun.version}`, private: true });
    expect(out).not.toHaveProperty("sideEffects");
  });

  it("fills only the keys that are missing", () => {
    const dest = tmp("pj-keys-some-");
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app", private: false }));
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
    expect(readPkg(dest)).toMatchObject({
      packageManager: `bun@${Bun.version}`,
      private: false,
      sideEffects: false,
    });
  });

  it("adds no rulesync, smol-toml or @clack/prompts, even when the package lists them", () => {
    const dest = tmp("pj-nodeps-");
    mergePackageJson(
      dest,
      stubPkgRoot({
        dependencies: { "@clack/prompts": "1", "smol-toml": "^1.8.0" },
        devDependencies: { rulesync: "latest" },
        name: PACKAGE_NAME,
        version: "0.7.0",
      }),
    );
    expect(Object.keys(readPkg(dest).devDependencies)).toEqual([PACKAGE_NAME]);
  });

  it("keeps the repo's own scripts and dependencies, sorted", () => {
    const dest = tmp("pj-exist-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        devDependencies: { lodash: "4", rulesync: "9" },
        name: "app",
        scripts: { claude: "bun run build && claude", foo: "bar", test: "jest" },
      }),
    );
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
    const out = readPkg(dest);
    expect(out.scripts).toEqual({
      claude: "bun run build && claude",
      foo: "bar",
      postinstall: "repo sync --postinstall",
      test: "jest",
    });
    expect(Object.keys(out.scripts)).toEqual(["claude", "foo", "postinstall", "test"]);
    expect(out.devDependencies).toEqual({ [PACKAGE_NAME]: "0.7.0", lodash: "4", rulesync: "9" });
    expect(Object.keys(out.devDependencies)).toEqual([PACKAGE_NAME, "lodash", "rulesync"]);
  });

  it("removes repo: scripts still equal to a value an older init wrote, and keeps edited ones", () => {
    const dest = tmp("pj-old-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        name: "app",
        scripts: {
          doctor: "bun ./.rulesync/scripts/doctor.ts",
          "repo:clean": "repo clean",
          "repo:doctor": "bun ./.rulesync/scripts/doctor.ts",
          "repo:mine": "echo mine",
          "repo:rulesync:generate": "bun ./.rulesync/scripts/guarded-roots.ts generate && bun run build",
          "repo:setup": "repo setup && echo done",
          "repo:sync:globals:apply": "node .rulesync/scripts/sync-global-settings.mjs --apply",
        },
      }),
    );
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
    expect(readPkg(dest).scripts).toEqual({
      doctor: "bun ./.rulesync/scripts/doctor.ts",
      postinstall: "repo sync --postinstall",
      "repo:mine": "echo mine",
      "repo:rulesync:generate": "bun ./.rulesync/scripts/guarded-roots.ts generate && bun run build",
      "repo:setup": "repo setup && echo done",
    });
  });

  describe("postinstall runs repo sync", () => {
    function postinstallAfterMerge(existing?: string) {
      const dest = tmp("pj-postinstall-");
      const scripts = existing == null ? {} : { postinstall: existing };
      fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app", scripts }));
      mergePackageJson(dest, stubPkgRoot());
      return readPkg(dest).scripts.postinstall;
    }

    it("adds it when the repo has no postinstall", () => {
      expect(postinstallAfterMerge()).toBe("repo sync --postinstall");
    });

    it("runs it before a postinstall the repo already has", () => {
      expect(postinstallAfterMerge("husky")).toBe("repo sync --postinstall && husky");
    });

    it("leaves a postinstall that already runs repo sync alone, so re-init converges", () => {
      expect(postinstallAfterMerge("repo sync --postinstall && husky")).toBe("repo sync --postinstall && husky");
      expect(postinstallAfterMerge("husky && repo sync")).toBe("husky && repo sync");
    });
  });

  it("early return when name is @workerstack/repo", () => {
    const dest = tmp("pj-self-");
    const raw = `${JSON.stringify({ name: "@workerstack/repo", scripts: { test: "x" } }, null, 2)}\n`;
    fs.writeFileSync(path.join(dest, "package.json"), raw);
    mergePackageJson(dest, stubPkgRoot());
    expect(fs.readFileSync(path.join(dest, "package.json"), "utf8")).toBe(raw);
  });

  it("moves @workerstack/repo from dependencies to devDependencies", () => {
    const dest = tmp("pj-repo-dep-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ dependencies: { [PACKAGE_NAME]: "0.6.2", lodash: "4" }, name: "app" }),
    );
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.6.2" }));
    const out = readPkg(dest);
    expect(out.dependencies).toEqual({ lodash: "4" });
    expect(out.devDependencies[PACKAGE_NAME]).toBe("0.6.2");
  });

  it("drops empty dependencies after moving repo", () => {
    const dest = tmp("pj-repo-onlydep-");
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ dependencies: { [PACKAGE_NAME]: "0.6.2" } }));
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
    const out = readPkg(dest);
    expect(out.dependencies).toBeUndefined();
    expect(out.devDependencies[PACKAGE_NAME]).toBe("0.6.2");
  });

  it("adds missing repo as a devDependency from the running package version", () => {
    const dest = tmp("pj-repo-add-");
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app" }));
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
    expect(readPkg(dest).devDependencies[PACKAGE_NAME]).toBe("0.7.0");
  });

  it("keeps an existing repo devDependency version", () => {
    const dest = tmp("pj-repo-keep-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        dependencies: { [PACKAGE_NAME]: "0.6.2" },
        devDependencies: { [PACKAGE_NAME]: "^0.6.2" },
      }),
    );
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
    const out = readPkg(dest);
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

  it.each([
    ["an array", []],
    ["a numeric name", { name: 1 }],
    ["a numeric version", { version: 1 }],
    ["a script that is not a string", { scripts: { a: 1 } }],
    ["scripts as an array", { scripts: [] }],
    ["dependencies as a string", { dependencies: "x" }],
  ])("package.json refused for %s", (_name, pkg) => {
    const dest = tmp("pj-wrong-");
    const file = path.join(dest, "package.json");
    fs.writeFileSync(file, JSON.stringify(pkg));
    expect(() => mergePackageJson(dest, stubPkgRoot())).toThrowError(`${file} does not hold`);
  });
});

describe("workerstack.config.ts", () => {
  it("writes the default packs and all five hosts when the repo has no config", () => {
    const dest = tmp("repo-config-");
    init(dest, { execFileSync: vi.fn(), pkgRoot: stubPkgRoot() });
    expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(config(DEFAULT_BODY));
    expect(HOSTS).toEqual(["claude", "codex", "antigravity", "grok", "cursor"]);
  });

  it("writes the same default packs when package.json declares workspaces", () => {
    const dest = tmp("repo-config-ws-");
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app", workspaces: ["packages/*"] }));
    init(dest, { execFileSync: vi.fn(), pkgRoot: stubPkgRoot() });
    expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(config(DEFAULT_BODY));
  });

  it("keeps a config the repo already has", () => {
    const dest = tmp("repo-config-keep-");
    const own = 'export default { packs: ["docs"] }\n';
    fs.writeFileSync(path.join(dest, "workerstack.config.ts"), own);
    init(dest, { execFileSync: vi.fn(), packs: ["listen"], pkgRoot: stubPkgRoot() });
    expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(own);
  });

  it("writes the default packs for a dir without package.json", () => {
    const dest = tmp("repo-config-bare-");
    writeConfigIfMissing(dest);
    expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(config(DEFAULT_BODY));
  });

  it("writes the chosen skill packs as agents.skills", () => {
    const dest = tmp("repo-config-skills-");
    writeConfigIfMissing(dest, ["listen", "speak"]);
    expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(
      config(`${PACKS_LINE}  agents: { hosts: [${HOSTS_LIST}], skills: ["listen", "speak"] },\n`),
    );
  });

  it("breaks agents over lines when one line would pass 120 columns", () => {
    const dest = tmp("repo-config-wide-");
    writeConfigIfMissing(dest, [...SKILL_PACKS]);
    expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(
      config(
        `${PACKS_LINE}  agents: {\n    hosts: [${HOSTS_LIST}],\n    skills: ["google-workspace", "listen", "speak", "clasp"],\n  },\n`,
      ),
    );
  });

  it.each([[[]], [["listen"]], [[...SKILL_PACKS]]])(
    "writes files the pinned oxfmt finds formatted under the standards config (skills %j)",
    (skills) => {
      const dest = tmp("repo-config-fmt-");
      fs.writeFileSync(
        path.join(dest, "package.json"),
        JSON.stringify({ name: "app", scripts: { build: "tsc" }, workspaces: ["packages/*"] }),
      );
      init(dest, { execFileSync: vi.fn(), packs: skills, pkgRoot: stubPkgRoot() });
      const ctx = {
        config: { agents: NO_AGENTS, packs: ["standards" as const], ...BASE_CONFIG },
        read: () => null,
        root: dest,
        workspace: { manifest: {}, packages: [], root: dest },
      };
      for (const output of standards(ctx, []).outputs) {
        if (output.kind === "file") {
          fs.mkdirSync(path.dirname(path.join(dest, output.path)), { recursive: true });
          fs.writeFileSync(path.join(dest, output.path), output.content);
        }
      }
      const pkg = Bun.resolveSync("oxfmt/package.json", import.meta.dirname);
      const bin = path.join(
        path.dirname(pkg),
        (JSON.parse(fs.readFileSync(pkg, "utf8")) as { bin: { oxfmt: string } }).bin.oxfmt,
      );
      const run = spawnSync(process.execPath, [bin, "--check"], { cwd: dest, encoding: "utf8" });
      expect(run.stdout + run.stderr).toContain("All matched files use the correct format");
      expect(run.status).toBe(0);
    },
  );

  it("writes no skills key for an empty choice", () => {
    const dest = tmp("repo-config-none-");
    writeConfigIfMissing(dest, []);
    expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(config(DEFAULT_BODY));
  });
});

describe("init", () => {
  it("a fresh init writes only workerstack.config.ts, package.json and an empty .mcp.json, installs, then syncs globals", () => {
    const dest = tmp("repo-dest-");
    const exec = vi.fn();
    const out: string[] = [];
    init(dest, {
      execFileSync: exec,
      pkgRoot: stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }),
      stdout: (s) => out.push(s),
    });

    expect(fs.readdirSync(dest).sort()).toEqual([".mcp.json", "package.json", "workerstack.config.ts"]);
    expect(fs.readFileSync(path.join(dest, ".mcp.json"), "utf8")).toBe('{\n  "mcpServers": {}\n}\n');
    expect(out).toEqual(["repo init: wrote .mcp.json\n"]);
    expect(readPkg(dest)).toEqual({
      devDependencies: { [PACKAGE_NAME]: "0.7.0" },
      packageManager: `bun@${Bun.version}`,
      private: true,
      scripts: { postinstall: "repo sync --postinstall" },
      sideEffects: false,
    });
    expect(exec.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["git", ["rev-parse", "--is-inside-work-tree"]],
      ["bun", ["install"]],
      ["bun", ["repo", "yolo"]],
    ]);
    for (const call of exec.mock.calls.filter((c) => c[0] === "bun"))
      expect(call[2]).toEqual({ cwd: dest, stdio: "inherit" });
  });

  it("outside a git work tree runs git init in the dest before the install and says so", () => {
    const dest = tmp("repo-dest-");
    const out: string[] = [];
    const exec = vi.fn<NonNullable<InitOptions["execFileSync"]>>((cmd, args) => {
      if (cmd === "git" && args[0] === "rev-parse") throw new Error("not a git repository");
    });
    init(dest, { execFileSync: exec, pkgRoot: stubPkgRoot(), skipGlobals: true, stdout: (s) => out.push(s) });
    expect(exec.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([
      ["git", ["rev-parse", "--is-inside-work-tree"]],
      ["git", ["init", "-q"]],
      ["bun", ["install"]],
    ]);
    expect(exec.mock.calls.map(([, , opts]) => opts.cwd)).toEqual([dest, dest, dest]);
    expect(out).toContain("repo init: ran git init\n");
  });

  it("inside a git work tree does not run git init or print it", () => {
    const dest = tmp("repo-dest-");
    const out: string[] = [];
    const exec = vi.fn<NonNullable<InitOptions["execFileSync"]>>();
    init(dest, { execFileSync: exec, pkgRoot: stubPkgRoot(), skipGlobals: true, stdout: (s) => out.push(s) });
    expect(exec.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([
      ["git", ["rev-parse", "--is-inside-work-tree"]],
      ["bun", ["install"]],
    ]);
    expect(out.join("")).not.toContain("ran git init");
  });

  it("prints that it ran git init on the process's stdout when given no stdout", () => {
    const dest = tmp("repo-git-stdout-");
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const exec = vi.fn<NonNullable<InitOptions["execFileSync"]>>((cmd, args) => {
      if (cmd === "git" && args[0] === "rev-parse") throw new Error("not a git repository");
    });
    init(dest, { execFileSync: exec, pkgRoot: stubPkgRoot(), skipGlobals: true });
    expect(write.mock.calls.map(([chunk]) => String(chunk))).toContain("repo init: ran git init\n");
    write.mockRestore();
  });

  it("keeps a .mcp.json the repo already has and says nothing of it", () => {
    const dest = tmp("repo-mcp-kept-");
    fs.writeFileSync(path.join(dest, ".mcp.json"), "mine\n");
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    init(dest, { execFileSync: vi.fn(), pkgRoot: stubPkgRoot() });
    expect(fs.readFileSync(path.join(dest, ".mcp.json"), "utf8")).toBe("mine\n");
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it("--packs listen writes agents.skills into a new config", () => {
    const dest = tmp("repo-packs-");
    init(dest, { execFileSync: vi.fn(), packs: ["listen"], pkgRoot: stubPkgRoot() });
    expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toContain(
      `agents: { hosts: [${HOSTS_LIST}], skills: ["listen"] }`,
    );
  });

  it("over a copied consumer removes old default repo: scripts, keeps edited ones, copies nothing", () => {
    const dest = tmp("repo-copied-");
    fs.mkdirSync(path.join(dest, ".rulesync"));
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        devDependencies: { rulesync: "9", "smol-toml": "1" },
        name: "app",
        scripts: { "repo:clean": "repo clean && rm -rf dist", "repo:doctor": "bun ./.rulesync/scripts/doctor.ts" },
      }),
    );
    init(dest, { execFileSync: vi.fn(), pkgRoot: stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }) });
    expect(readPkg(dest).scripts).toEqual({
      postinstall: "repo sync --postinstall",
      "repo:clean": "repo clean && rm -rf dist",
    });
    expect(fs.readdirSync(dest).sort()).toEqual([".mcp.json", ".rulesync", "package.json", "workerstack.config.ts"]);
    expect(fs.readdirSync(path.join(dest, ".rulesync"))).toEqual([]);
  });

  it("--skip-globals only installs", () => {
    const dest = tmp("repo-skip-globals-");
    const exec = vi.fn();
    init(dest, { execFileSync: exec, pkgRoot: stubPkgRoot(), skipGlobals: true });
    expect(exec.mock.calls.map((c) => c[1])).toEqual([["rev-parse", "--is-inside-work-tree"], ["install"]]);
  });

  it("onPhase reports merge, install and yolo, each stopped before its exec", () => {
    const dest = tmp("repo-onphase-");
    const onPhase = vi.fn();
    init(dest, { execFileSync: vi.fn(), onPhase, pkgRoot: stubPkgRoot() });
    expect(onPhase.mock.calls).toEqual([
      ["merge", "start"],
      ["merge", "stop"],
      ["install", "start"],
      ["install", "stop"],
      ["yolo", "start"],
      ["yolo", "stop"],
    ]);
  });

  it("omitted pkgRoot uses the built-in package root", () => {
    const dest = tmp("repo-realroot-");
    init(dest, { execFileSync: vi.fn() });
    expect(readPkg(dest).devDependencies[PACKAGE_NAME]).toBe(readPkg(PKG_ROOT).version);
    expect(fs.readdirSync(dest).sort()).toEqual([".mcp.json", "package.json", "workerstack.config.ts"]);
  });

  it("self init changes nothing and runs nothing", () => {
    const pkgRoot = stubPkgRoot({ name: "fixture-pkg", scripts: { test: "x" }, version: "1.2.3" });
    const before = fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8");
    const exec = vi.fn();
    const onPhase = vi.fn();
    init(pkgRoot, { execFileSync: exec, onPhase, pkgRoot });
    expect(exec).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8")).toBe(before);
    expect(fs.readdirSync(pkgRoot)).toEqual(["package.json"]);
    expect(onPhase).not.toHaveBeenCalled();
  });

  it("with no options, init on this package changes nothing", () => {
    const pkgPath = path.join(PKG_ROOT, "package.json");
    const before = fs.readFileSync(pkgPath, "utf8");
    init(PKG_ROOT);
    expect(fs.readFileSync(pkgPath, "utf8")).toBe(before);
  });

  it("omitted execFileSync uses the default; self never invokes it", () => {
    const pkgRoot = stubPkgRoot();
    expect(() => init(pkgRoot, { pkgRoot })).not.toThrow();
  });
});
