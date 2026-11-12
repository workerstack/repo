import { describe, expect, it } from "vitest";

import { useTempTree } from "./__fixtures__/temp-tree.ts";
import { checkManifests } from "./check-manifests.ts";
import type { JsonObject } from "./json.ts";
import { readWorkspace } from "./sync/workspace.ts";

const plant = useTempTree("workerstack-manifests-");

const PIN = `bun@${Bun.version}`;

/** Writes each manifest into a temp repo, reads it as `repo check` does and returns the problem lines. */
function problems(files: Record<string, JsonObject>): string[] {
  const texts = Object.entries(files).map(([rel, content]): [string, string] => [rel, JSON.stringify(content)]);
  const result = readWorkspace(plant(Object.fromEntries(texts)));

  if (!result.ok) throw new Error(result.errors.join("\n"));

  return checkManifests(result.workspace);
}

describe("checkManifests", () => {
  it("passes a private single-package root with sideEffects false and a pinned bun", () => {
    expect(
      problems({ "package.json": { name: "a", packageManager: "bun@1.4.4", private: true, sideEffects: false } }),
    ).toStrictEqual([]);
  });

  it("passes a published single-package root with a version", () => {
    expect(
      problems({
        "package.json": { name: "a", packageManager: PIN, private: false, sideEffects: false, version: "1.0.0" },
      }),
    ).toStrictEqual([]);
  });

  it("accepts a prerelease pin", () => {
    expect(
      problems({ "package.json": { packageManager: "bun@1.5.0-canary.3", private: true, sideEffects: false } }),
    ).toStrictEqual([]);
  });
});

describe("checkManifests missing fields", () => {
  it("reports a missing private", () => {
    expect(problems({ "package.json": { packageManager: PIN, sideEffects: false } })).toStrictEqual([
      'package.json: "private" is missing; set true, or false to publish it',
    ]);
  });

  it("reports a missing sideEffects", () => {
    const files = {
      "package.json": { packageManager: PIN, private: true, workspaces: ["packages/*"] },
      "packages/web/package.json": { name: "web", private: true },
    };

    expect(problems(files)).toStrictEqual(['packages/web/package.json: "sideEffects" is missing; set it to false']);
  });

  it.each([
    [["*.css"], '["*.css"]'],
    [true, "true"],
    ["false", '"false"'],
  ])("reports sideEffects %j and names the CSS fix", (value, shown) => {
    const files = {
      "package.json": { packageManager: PIN, private: true, workspaces: ["packages/*"] },
      "packages/ui/package.json": { private: true, sideEffects: value },
    };

    expect(problems(files)).toStrictEqual([
      `packages/ui/package.json: "sideEffects" is ${shown}; set it to false and import CSS from an app entry`,
    ]);
  });
});

describe("checkManifests versions and packageManager", () => {
  it("reports a version on a private package", () => {
    const files = {
      "package.json": { packageManager: PIN, private: true, workspaces: ["packages/*"] },
      "packages/api/package.json": { private: true, sideEffects: false, version: "1.0.0" },
    };

    expect(problems(files)).toStrictEqual(['packages/api/package.json: private packages have no "version"; delete it']);
  });

  it("allows a version on a package that is not private", () => {
    const files = {
      "package.json": { packageManager: PIN, private: true, workspaces: ["packages/*"] },
      "packages/api/package.json": { private: false, sideEffects: false, version: "1.0.0" },
    };

    expect(problems(files)).toStrictEqual([]);
  });

  it("reports a version on a private root", () => {
    expect(
      problems({ "package.json": { packageManager: PIN, private: true, sideEffects: false, version: "0.0.0" } }),
    ).toStrictEqual(['package.json: private packages have no "version"; delete it']);
  });
});

describe("checkManifests packageManager", () => {
  it("reports a missing packageManager with the running bun version", () => {
    expect(problems({ "package.json": { private: true, sideEffects: false } })).toStrictEqual([
      `package.json: "packageManager" is missing; set it to "${PIN}"`,
    ]);
  });

  it.each([["bun@^1.4"], ["bun@1.4"], ["bun@latest"], ["pnpm@9.0.0"], ["bun@1.4.4+sha"]])(
    "reports packageManager %s as not an exact bun pin",
    (value) => {
      expect(problems({ "package.json": { packageManager: value, private: true, sideEffects: false } })).toStrictEqual([
        `package.json: "packageManager" is "${value}"; pin an exact version like "${PIN}"`,
      ]);
    },
  );

  it("reports a packageManager that is not a string", () => {
    expect(problems({ "package.json": { packageManager: 4, private: true, sideEffects: false } })).toStrictEqual([
      `package.json: "packageManager" is 4; pin an exact version like "${PIN}"`,
    ]);
  });
});

describe("checkManifests roots and packages", () => {
  it("holds a monorepo root to private, version and packageManager but not sideEffects", () => {
    expect(problems({ "package.json": { private: true, version: "1.0.0", workspaces: ["packages/*"] } })).toStrictEqual(
      [
        'package.json: private packages have no "version"; delete it',
        `package.json: "packageManager" is missing; set it to "${PIN}"`,
      ],
    );
  });
});

describe("checkManifests workspaces", () => {
  it("passes a two-package workspace", () => {
    const files = {
      "package.json": { packageManager: "bun@1.4.4", private: true, workspaces: { packages: ["packages/*"] } },
      "packages/api/package.json": { private: true, sideEffects: false },
      "packages/web/package.json": { private: true, sideEffects: false },
    };

    expect(problems(files)).toStrictEqual([]);
  });

  it("lists the root first, then each package by directory", () => {
    const files = {
      "package.json": { workspaces: ["packages/*"] },
      "packages/api/package.json": {},
      "packages/web/package.json": {},
    };

    expect(problems(files)).toStrictEqual([
      'package.json: "private" is missing; set true, or false to publish it',
      `package.json: "packageManager" is missing; set it to "${PIN}"`,
      'packages/api/package.json: "private" is missing; set true, or false to publish it',
      'packages/api/package.json: "sideEffects" is missing; set it to false',
      'packages/web/package.json: "private" is missing; set true, or false to publish it',
      'packages/web/package.json: "sideEffects" is missing; set it to false',
    ]);
  });

  it("leaves a root without package.json alone", () => {
    expect(problems({})).toStrictEqual([]);
  });
});

function chain(name: string, n: number) {
  return `package.json: "${name}" chains ${n} tool calls with "&&" or ";"; make it one call, such as "repo ci"`;
}

describe("checkManifests chained root scripts", () => {
  const root = { packageManager: "bun@1.4.4", private: true, sideEffects: false };

  function withScripts(scripts: Record<string, string>) {
    return problems({ "package.json": { ...root, scripts } });
  }

  it("names a script chained with &&", () => {
    expect(withScripts({ test: "a && b" })).toStrictEqual([chain("test", 2)]);
  });

  it("names a script chained with ;", () => {
    expect(withScripts({ test: "a; b" })).toStrictEqual([chain("test", 2)]);
  });

  it("counts three calls", () => {
    expect(withScripts({ ci: "a && b ; c" })).toStrictEqual([chain("ci", 3)]);
  });

  it("does not split inside quotes", () => {
    expect(withScripts({ a: 'echo "a && b"', b: "echo 'a; b'", c: 'echo "it\'s && x" && y' })).toStrictEqual([
      chain("c", 2),
    ]);
  });

  it("leaves || and | alone, and ignores empty segments", () => {
    expect(withScripts({ a: "a || b", b: "a | b", c: "a &&", d: "; a ;", e: "a" })).toStrictEqual([]);
  });
});

describe("checkManifests script shapes", () => {
  const root = { packageManager: "bun@1.4.4", private: true, sideEffects: false };

  it("skips scripts that are not strings", () => {
    expect(problems({ "package.json": { ...root, scripts: { a: 1 } } })).toStrictEqual([]);
    expect(problems({ "package.json": { ...root, scripts: "a && b" } })).toStrictEqual([]);
  });

  it("judges only the root's scripts", () => {
    const files = {
      "package.json": { packageManager: "bun@1.4.4", private: true, workspaces: ["packages/*"] },
      "packages/a/package.json": { private: true, scripts: { test: "a && b" }, sideEffects: false },
    };

    expect(problems(files)).toStrictEqual([]);
  });
});
