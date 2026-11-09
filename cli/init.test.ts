import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aliasOf } from "../dev/test-paths";
import { HOSTS, SKILL_PACKS, DEFAULT_COMMIT } from "./config.ts";
import {
  PACKAGE_NAME,
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
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tmp(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

interface PackageJson {
  name?: string;
  version?: string;
  scripts: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
}

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
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0", scripts: { alpha: "a" } }));
    expect(readPkg(dest)).toEqual({
      scripts: { postinstall: "repo sync --postinstall" },
      devDependencies: { [PACKAGE_NAME]: "0.7.0" },
      private: true,
      sideEffects: false,
      packageManager: `bun@${Bun.version}`,
    });
  });

  it("writes private, sideEffects and packageManager on the root only when they are absent", () => {
    const dest = tmp("pj-keys-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({ name: "app", private: false, sideEffects: ["*.css"], packageManager: "bun@^1.4" }),
    );
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
    const out = readPkg(dest);
    expect(out).toMatchObject({ private: false, sideEffects: ["*.css"], packageManager: "bun@^1.4" });
  });

  it("leaves sideEffects off a root that has workspaces", () => {
    const dest = tmp("pj-keys-mono-");
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "mono", workspaces: ["packages/*"] }));
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
    const out = readPkg(dest);
    expect(out).toMatchObject({ private: true, packageManager: `bun@${Bun.version}` });
    expect(out).not.toHaveProperty("sideEffects");
  });

  it("fills only the keys that are missing", () => {
    const dest = tmp("pj-keys-some-");
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app", private: false }));
    mergePackageJson(dest, stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }));
    expect(readPkg(dest)).toMatchObject({
      private: false,
      sideEffects: false,
      packageManager: `bun@${Bun.version}`,
    });
  });

  it("adds no rulesync, smol-toml or @clack/prompts, even when the package lists them", () => {
    const dest = tmp("pj-nodeps-");
    mergePackageJson(
      dest,
      stubPkgRoot({
        name: PACKAGE_NAME,
        version: "0.7.0",
        dependencies: { "smol-toml": "^1.8.0", "@clack/prompts": "1" },
        devDependencies: { rulesync: "latest" },
      }),
    );
    expect(Object.keys(readPkg(dest).devDependencies)).toEqual([PACKAGE_NAME]);
  });

  it("keeps the repo's own scripts and dependencies, sorted", () => {
    const dest = tmp("pj-exist-");
    fs.writeFileSync(
      path.join(dest, "package.json"),
      JSON.stringify({
        name: "app",
        scripts: { test: "jest", foo: "bar", claude: "bun run build && claude" },
        devDependencies: { lodash: "4", rulesync: "9" },
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
          "repo:doctor": "bun ./.rulesync/scripts/doctor.ts",
          "repo:clean": "repo clean",
          "repo:sync:globals:apply": "node .rulesync/scripts/sync-global-settings.mjs --apply",
          "repo:rulesync:generate": "bun ./.rulesync/scripts/guarded-roots.ts generate && bun run build",
          "repo:setup": "repo setup && echo done",
          "repo:mine": "echo mine",
          doctor: "bun ./.rulesync/scripts/doctor.ts",
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
      JSON.stringify({ name: "app", dependencies: { [PACKAGE_NAME]: "0.6.2", lodash: "4" } }),
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
        devDependencies: { [PACKAGE_NAME]: "^0.6.2" },
        dependencies: { [PACKAGE_NAME]: "0.6.2" },
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
    init(dest, { pkgRoot: stubPkgRoot(), execFileSync: vi.fn() });
    expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(config(DEFAULT_BODY));
    expect(HOSTS).toEqual(["claude", "codex", "antigravity", "grok", "cursor"]);
  });

  it("writes the same default packs when package.json declares workspaces", () => {
    const dest = tmp("repo-config-ws-");
    fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: "app", workspaces: ["packages/*"] }));
    init(dest, { pkgRoot: stubPkgRoot(), execFileSync: vi.fn() });
    expect(fs.readFileSync(path.join(dest, "workerstack.config.ts"), "utf8")).toBe(config(DEFAULT_BODY));
  });

  it("keeps a config the repo already has", () => {
    const dest = tmp("repo-config-keep-");
    const own = 'export default { packs: ["docs"] }\n';
    fs.writeFileSync(path.join(dest, "workerstack.config.ts"), own);
    init(dest, { pkgRoot: stubPkgRoot(), execFileSync: vi.fn(), packs: ["listen"] });
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
        JSON.stringify({ name: "app", workspaces: ["packages/*"], scripts: { build: "tsc" } }),
      );
      init(dest, { pkgRoot: stubPkgRoot(), execFileSync: vi.fn(), packs: skills });
      const ctx = {
        root: dest,
        config: { packs: ["standards" as const], agents: NO_AGENTS, commit: DEFAULT_COMMIT, lint: { skip: [] } },
        workspace: { root: dest, manifest: {}, packages: [] },
        read: () => null,
      };
      for (const output of standards(ctx, []).outputs)
        if (output.kind === "file") {
          fs.mkdirSync(path.dirname(path.join(dest, output.path)), { recursive: true });
          fs.writeFileSync(path.join(dest, output.path), output.content);
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
  it("a fresh init writes only workerstack.config.ts and package.json, installs, then syncs globals", () => {
    const dest = tmp("repo-dest-");
    const exec = vi.fn();
    init(dest, { pkgRoot: stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }), execFileSync: exec });

    expect(fs.readdirSync(dest).sort()).toEqual(["package.json", "workerstack.config.ts"]);
    expect(readPkg(dest)).toEqual({
      scripts: { postinstall: "repo sync --postinstall" },
      devDependencies: { [PACKAGE_NAME]: "0.7.0" },
      private: true,
      sideEffects: false,
      packageManager: `bun@${Bun.version}`,
    });
    expect(exec.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["bun", ["install"]],
      ["bun", ["repo", "yolo"]],
    ]);
    for (const call of exec.mock.calls) {
      expect(call[2]).toEqual({ cwd: dest, stdio: "inherit" });
    }
  });

  it("--packs listen writes agents.skills into a new config", () => {
    const dest = tmp("repo-packs-");
    init(dest, { pkgRoot: stubPkgRoot(), execFileSync: vi.fn(), packs: ["listen"] });
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
        name: "app",
        scripts: { "repo:doctor": "bun ./.rulesync/scripts/doctor.ts", "repo:clean": "repo clean && rm -rf dist" },
        devDependencies: { rulesync: "9", "smol-toml": "1" },
      }),
    );
    init(dest, { pkgRoot: stubPkgRoot({ name: PACKAGE_NAME, version: "0.7.0" }), execFileSync: vi.fn() });
    expect(readPkg(dest).scripts).toEqual({
      postinstall: "repo sync --postinstall",
      "repo:clean": "repo clean && rm -rf dist",
    });
    expect(fs.readdirSync(dest).sort()).toEqual([".rulesync", "package.json", "workerstack.config.ts"]);
    expect(fs.readdirSync(path.join(dest, ".rulesync"))).toEqual([]);
  });

  it("--skip-globals only installs", () => {
    const dest = tmp("repo-skip-globals-");
    const exec = vi.fn();
    init(dest, { pkgRoot: stubPkgRoot(), execFileSync: exec, skipGlobals: true });
    expect(exec.mock.calls.map((c) => c[1])).toEqual([["install"]]);
  });

  it("onPhase reports merge, install and yolo, each stopped before its exec", () => {
    const dest = tmp("repo-onphase-");
    const onPhase = vi.fn();
    init(dest, { pkgRoot: stubPkgRoot(), execFileSync: vi.fn(), onPhase });
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
    expect(fs.readdirSync(dest).sort()).toEqual(["package.json", "workerstack.config.ts"]);
  });

  it("self init changes nothing and runs nothing", () => {
    const pkgRoot = stubPkgRoot({ name: "fixture-pkg", version: "1.2.3", scripts: { test: "x" } });
    const before = fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8");
    const exec = vi.fn();
    const onPhase = vi.fn();
    init(pkgRoot, { pkgRoot, execFileSync: exec, onPhase });
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
