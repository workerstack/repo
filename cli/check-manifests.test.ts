import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkManifests } from "./check-manifests.ts";
import { readWorkspace } from "./sync/workspace.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const PIN = `bun@${Bun.version}`;

/** Writes each manifest into a temp repo, reads it as `repo check` does and returns the problem lines. */
function problems(files: Record<string, object>): string[] {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-manifests-"));
  temps.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(content));
  }
  const result = readWorkspace(root);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return checkManifests(result.workspace);
}

describe("checkManifests", () => {
  it("passes a private single-package root with sideEffects false and a pinned bun", () => {
    expect(
      problems({ "package.json": { name: "a", private: true, sideEffects: false, packageManager: "bun@1.4.4" } }),
    ).toEqual([]);
  });

  it("passes a published single-package root with a version", () => {
    expect(
      problems({
        "package.json": { name: "a", version: "1.0.0", private: false, sideEffects: false, packageManager: PIN },
      }),
    ).toEqual([]);
  });

  it("accepts a prerelease pin", () => {
    expect(
      problems({ "package.json": { private: true, sideEffects: false, packageManager: "bun@1.5.0-canary.3" } }),
    ).toEqual([]);
  });
});

describe("checkManifests missing fields", () => {
  it("reports a missing private", () => {
    expect(problems({ "package.json": { sideEffects: false, packageManager: PIN } })).toEqual([
      'package.json: "private" is missing; set true, or false to publish it',
    ]);
  });

  it("reports a missing sideEffects", () => {
    const files = {
      "package.json": { private: true, workspaces: ["packages/*"], packageManager: PIN },
      "packages/web/package.json": { name: "web", private: true },
    };
    expect(problems(files)).toEqual(['packages/web/package.json: "sideEffects" is missing; set it to false']);
  });

  it.each([
    [["*.css"], '["*.css"]'],
    [true, "true"],
    ["false", '"false"'],
  ])("reports sideEffects %j and names the CSS fix", (value, shown) => {
    const files = {
      "package.json": { private: true, workspaces: ["packages/*"], packageManager: PIN },
      "packages/ui/package.json": { private: true, sideEffects: value },
    };
    expect(problems(files)).toEqual([
      `packages/ui/package.json: "sideEffects" is ${shown}; set it to false and import CSS from an app entry`,
    ]);
  });
});

describe("checkManifests versions and packageManager", () => {
  it("reports a version on a private package", () => {
    const files = {
      "package.json": { private: true, workspaces: ["packages/*"], packageManager: PIN },
      "packages/api/package.json": { private: true, version: "1.0.0", sideEffects: false },
    };
    expect(problems(files)).toEqual(['packages/api/package.json: private packages have no "version"; delete it']);
  });

  it("allows a version on a package that is not private", () => {
    const files = {
      "package.json": { private: true, workspaces: ["packages/*"], packageManager: PIN },
      "packages/api/package.json": { private: false, version: "1.0.0", sideEffects: false },
    };
    expect(problems(files)).toEqual([]);
  });

  it("reports a version on a private root", () => {
    expect(
      problems({ "package.json": { private: true, version: "0.0.0", sideEffects: false, packageManager: PIN } }),
    ).toEqual(['package.json: private packages have no "version"; delete it']);
  });
});

describe("checkManifests packageManager", () => {
  it("reports a missing packageManager with the running bun version", () => {
    expect(problems({ "package.json": { private: true, sideEffects: false } })).toEqual([
      `package.json: "packageManager" is missing; set it to "${PIN}"`,
    ]);
  });

  it.each([["bun@^1.4"], ["bun@1.4"], ["bun@latest"], ["pnpm@9.0.0"], ["bun@1.4.4+sha"]])(
    "reports packageManager %s as not an exact bun pin",
    (value) => {
      expect(problems({ "package.json": { private: true, sideEffects: false, packageManager: value } })).toEqual([
        `package.json: "packageManager" is "${value}"; pin an exact version like "${PIN}"`,
      ]);
    },
  );

  it("reports a packageManager that is not a string", () => {
    expect(problems({ "package.json": { private: true, sideEffects: false, packageManager: 4 } })).toEqual([
      `package.json: "packageManager" is 4; pin an exact version like "${PIN}"`,
    ]);
  });
});

describe("checkManifests roots and packages", () => {
  it("holds a monorepo root to private, version and packageManager but not sideEffects", () => {
    expect(problems({ "package.json": { workspaces: ["packages/*"], version: "1.0.0", private: true } })).toEqual([
      'package.json: private packages have no "version"; delete it',
      `package.json: "packageManager" is missing; set it to "${PIN}"`,
    ]);
  });
});

describe("checkManifests workspaces", () => {
  it("passes a two-package workspace", () => {
    const files = {
      "package.json": { private: true, workspaces: { packages: ["packages/*"] }, packageManager: "bun@1.4.4" },
      "packages/api/package.json": { private: true, sideEffects: false },
      "packages/web/package.json": { private: true, sideEffects: false },
    };
    expect(problems(files)).toEqual([]);
  });

  it("lists the root first, then each package by directory", () => {
    const files = {
      "package.json": { workspaces: ["packages/*"] },
      "packages/web/package.json": {},
      "packages/api/package.json": {},
    };
    expect(problems(files)).toEqual([
      'package.json: "private" is missing; set true, or false to publish it',
      `package.json: "packageManager" is missing; set it to "${PIN}"`,
      'packages/api/package.json: "private" is missing; set true, or false to publish it',
      'packages/api/package.json: "sideEffects" is missing; set it to false',
      'packages/web/package.json: "private" is missing; set true, or false to publish it',
      'packages/web/package.json: "sideEffects" is missing; set it to false',
    ]);
  });

  it("leaves a root without package.json alone", () => {
    expect(problems({})).toEqual([]);
  });
});
