import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PACKAGE_MANAGERS,
  UNKNOWN_PACKAGE_MANAGER,
  detectFromInvocation,
  detectFromRepo,
  detectPackageManager,
  installArgs,
  isPackageManager,
  parsePackageManagerField,
  runScriptArgs,
  runScriptLine,
} from "./package-manager.mjs";

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

describe("isPackageManager / parsePackageManagerField", () => {
  it("accepts the four names", () => {
    expect(PACKAGE_MANAGERS).toEqual(["npm", "yarn", "pnpm", "bun"]);
    expect(isPackageManager("pnpm")).toBe(true);
    expect(isPackageManager("NPM")).toBe(true);
    expect(isPackageManager("foo")).toBe(false);
    expect(isPackageManager("")).toBe(false);
  });

  it("parses corepack field, object, and junk", () => {
    expect(parsePackageManagerField("pnpm@9.1.0")).toBe("pnpm");
    expect(parsePackageManagerField("yarn@3.6.0+sha512.abc")).toBe("yarn");
    expect(parsePackageManagerField({ name: "bun@1.1.0" })).toBe("bun");
    expect(parsePackageManagerField({ name: "npm" })).toBe("npm");
    expect(parsePackageManagerField("deno@1")).toBe(null);
    expect(parsePackageManagerField("")).toBe(null);
    expect(parsePackageManagerField(null)).toBe(null);
    expect(parsePackageManagerField(1)).toBe(null);
  });
});

describe("detectFromRepo", () => {
  it("reads packageManager field", () => {
    const cwd = tmp("pm-field-");
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ packageManager: "pnpm@9.0.0" }),
    );
    expect(detectFromRepo(cwd)).toEqual({ managers: ["pnpm"], lockfiles: [] });
  });

  it("reads devEngines.packageManager", () => {
    const cwd = tmp("pm-engines-");
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ devEngines: { packageManager: { name: "yarn", version: ">=1" } } }),
    );
    expect(detectFromRepo(cwd).managers).toEqual(["yarn"]);
  });

  it("lockfiles map to managers; duplicates stay unique", () => {
    const cwd = tmp("pm-locks-");
    fs.writeFileSync(path.join(cwd, "package-lock.json"), "{}");
    fs.writeFileSync(path.join(cwd, "npm-shrinkwrap.json"), "{}");
    expect(detectFromRepo(cwd)).toEqual({
      managers: ["npm"],
      lockfiles: ["package-lock.json", "npm-shrinkwrap.json"],
    });
  });

  it("bun.lock and bun.lockb are bun", () => {
    const a = tmp("pm-bunb-");
    fs.writeFileSync(path.join(a, "bun.lockb"), "x");
    expect(detectFromRepo(a).managers).toEqual(["bun"]);
    const b = tmp("pm-bunt-");
    fs.writeFileSync(path.join(b, "bun.lock"), "x");
    expect(detectFromRepo(b).managers).toEqual(["bun"]);
  });

  it("conflict when field and lockfile disagree", () => {
    const cwd = tmp("pm-conflict-");
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ packageManager: "pnpm@9.0.0" }),
    );
    fs.writeFileSync(path.join(cwd, "yarn.lock"), "");
    expect(detectFromRepo(cwd).managers.sort()).toEqual(["pnpm", "yarn"]);
  });

  it("ignores invalid package.json and missing cwd files", () => {
    const cwd = tmp("pm-badjson-");
    fs.writeFileSync(path.join(cwd, "package.json"), "{");
    expect(detectFromRepo(cwd)).toEqual({ managers: [], lockfiles: [] });
    expect(detectFromRepo(path.join(cwd, "nope"))).toEqual({ managers: [], lockfiles: [] });
  });
});

describe("detectFromInvocation", () => {
  it("reads npm_config_user_agent first token", () => {
    expect(
      detectFromInvocation({ npm_config_user_agent: "pnpm/9.12.3 npm/? node/v22.11.0" }),
    ).toBe("pnpm");
    expect(detectFromInvocation({ npm_config_user_agent: "yarn/1.22.22 npm/? node/v22" })).toBe(
      "yarn",
    );
    expect(detectFromInvocation({ npm_config_user_agent: "npm/10.8.1 node/v22.4.0" })).toBe("npm");
    expect(detectFromInvocation({ npm_config_user_agent: "bun/1.1.0 npm/? node/v22" })).toBe("bun");
  });

  it("reads npm_execpath basename", () => {
    expect(detectFromInvocation({ npm_execpath: "/usr/lib/pnpm/bin/pnpm.cjs" })).toBe("pnpm");
    expect(detectFromInvocation({ npm_execpath: "C:\\Program Files\\nodejs\\npm.cmd" })).toBe(
      "npm",
    );
    expect(detectFromInvocation({ npm_execpath: "/opt/yarn/bin/yarn.js" })).toBe("yarn");
    expect(detectFromInvocation({ npm_execpath: "/home/me/.bun/bin/bun" })).toBe("bun");
  });

  it("bun runtime versions.bun", () => {
    expect(detectFromInvocation({}, { versions: { bun: "1.1.0" } })).toBe("bun");
    expect(detectFromInvocation({}, { versions: {} })).toBe(null);
  });

  it("empty env is unknown", () => {
    expect(detectFromInvocation({})).toBe(null);
  });
});

describe("detectPackageManager", () => {
  it("override wins", () => {
    const cwd = tmp("pm-over-");
    fs.writeFileSync(path.join(cwd, "yarn.lock"), "");
    expect(detectPackageManager({ cwd, override: "pnpm", env: {} })).toEqual({
      manager: "pnpm",
      source: "flag",
    });
  });

  it("invalid override is error", () => {
    expect(detectPackageManager({ override: "deno", env: {} })).toMatchObject({
      manager: null,
      error: "invalid",
      override: "deno",
    });
  });

  it("repo unique wins over invocation", () => {
    const cwd = tmp("pm-repo-");
    fs.writeFileSync(path.join(cwd, "pnpm-lock.yaml"), "");
    expect(
      detectPackageManager({
        cwd,
        env: { npm_config_user_agent: "npm/10.0.0 node/v22" },
      }),
    ).toMatchObject({ manager: "pnpm", source: "repo" });
  });

  it("invocation when repo empty", () => {
    const cwd = tmp("pm-inv-");
    expect(
      detectPackageManager({
        cwd,
        env: { npm_config_user_agent: "yarn/1.22.22 npm/? node/v22" },
      }),
    ).toMatchObject({ manager: "yarn", source: "invocation" });
  });

  it("invocation breaks repo conflict when it matches a candidate", () => {
    const cwd = tmp("pm-break-");
    fs.writeFileSync(path.join(cwd, "yarn.lock"), "");
    fs.writeFileSync(path.join(cwd, "package-lock.json"), "{}");
    expect(
      detectPackageManager({
        cwd,
        env: { npm_config_user_agent: "yarn/1.22.22 npm/? node/v22" },
      }),
    ).toMatchObject({ manager: "yarn", source: "invocation" });
  });

  it("unknown when conflict and invocation is a third manager", () => {
    const cwd = tmp("pm-third-");
    fs.writeFileSync(path.join(cwd, "yarn.lock"), "");
    fs.writeFileSync(path.join(cwd, "package-lock.json"), "{}");
    const r = detectPackageManager({
      cwd,
      env: { npm_config_user_agent: "bun/1.1.0 npm/? node/v22" },
    });
    expect(r.manager).toBe(null);
    expect(r.candidates?.sort()).toEqual(["npm", "yarn"]);
  });

  it("unknown when nothing", () => {
    const cwd = tmp("pm-none-");
    const r = detectPackageManager({ cwd, env: {}, versions: {} });
    expect(r).toMatchObject({ manager: null, source: null });
    expect(UNKNOWN_PACKAGE_MANAGER).toMatch(/--pm/);
  });
});

describe("run/install args", () => {
  it("install is install for every manager", () => {
    for (const pm of PACKAGE_MANAGERS) {
      expect(installArgs(pm)).toEqual(["install"]);
    }
  });

  it("npm extra uses --; others pass through", () => {
    expect(runScriptArgs("npm", "grunt:doctor")).toEqual(["run", "grunt:doctor"]);
    expect(runScriptArgs("npm", "grunt:setup", ["speak"])).toEqual([
      "run",
      "grunt:setup",
      "--",
      "speak",
    ]);
    expect(runScriptArgs("pnpm", "grunt:setup", ["speak", "--skip-verify"])).toEqual([
      "run",
      "grunt:setup",
      "speak",
      "--skip-verify",
    ]);
    expect(runScriptArgs("yarn", "grunt:setup", ["speak"])).toEqual([
      "run",
      "grunt:setup",
      "speak",
    ]);
    expect(runScriptArgs("bun", "grunt:setup", ["speak"])).toEqual(["run", "grunt:setup", "speak"]);
  });

  it("runScriptLine", () => {
    expect(runScriptLine("pnpm", "sync:globals:apply")).toBe("pnpm run sync:globals:apply");
    expect(runScriptLine(null, "sync:globals:apply")).toBe(
      "npm|yarn|pnpm|bun run sync:globals:apply",
    );
  });
});
