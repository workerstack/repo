import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removePlanted } from "../fixtures/planted-repo.ts";
import { apiDiff } from "./api-diff.ts";
import type { Change } from "./api-diff.ts";
import { diffFixtures, JS } from "./fixtures/api-diff-world.ts";
import { apiWorld } from "./fixtures/api-world.ts";

/** An `exports` condition map. Conditions resolve in order, so `types` stays before `default`. */
function conditions(types: string, runtime: string) {
  return {
    types,

    default: runtime,
  };
}

const TIMEOUT = 120_000;
let changes: Change[] = [];

beforeAll(() => {
  changes = diffFixtures();
}, TIMEOUT);

afterAll(removePlanted);

/** The kind of change of each name of one subpath, by name. */
function kinds(key: string): Record<string, string> {
  return Object.fromEntries(
    changes.filter((change) => change.key === key).map((change) => [String(change.name), change.kind]),
  );
}

describe("apiDiff subpaths", () => {
  it("reports a removed code subpath and an added one, not JSON or wildcard subpaths", () => {
    expect(changes.filter((change) => change.name === null)).toStrictEqual([
      { key: "./fresh", kind: "added", name: null },
      { key: "./gone", kind: "removed", name: null },
    ]);
    expect(changes.map((change) => change.key)).not.toContain("./extra");
    expect(changes.map((change) => change.key)).not.toContain("./agents/a.md");
  });

  it("finds no change in a class whose private member became a parameter property", () => {
    expect(kinds("./src")).toStrictEqual({});
  });
});

describe("apiDiff functions and names", () => {
  it("reports a removed name and an added one", () => {
    expect(kinds(".")).toMatchObject({ newConst: "added", removedConst: "removed" });
  });

  it("widens a parameter and narrows a return or a parameter", () => {
    expect(kinds(".")).toMatchObject({ narrowParam: "narrowed", widenParam: "widened", widenReturn: "narrowed" });
  });

  it("narrows a method-shorthand parameter, which the checker compares both ways", () => {
    expect(kinds(".")).toMatchObject({ Methods: "narrowed", Widens: "narrowed" });
  });
});

describe("apiDiff declarations", () => {
  it("narrows an interface with a new required field and widens one with a new optional field", () => {
    expect(kinds(".").Shape).toBe("narrowed");
    expect(kinds(".").Opt).toBe("widened");
  });

  it("narrows an interface that lost a field and a union that lost a member", () => {
    expect(kinds(".")).toMatchObject({ Fields: "narrowed", Loses: "narrowed" });
  });

  it("widens a union with a new member and a tuple const with a new literal", () => {
    expect(kinds(".")).toMatchObject({ PACKS: "widened", U: "widened" });
    expect(kinds(".")).not.toHaveProperty("ONE");
    expect(kinds(".")).not.toHaveProperty("MIXED");
  });

  it("narrows a class that lost a method", () => {
    expect(kinds(".").Shrunk).toBe("narrowed");
  });
});

describe("apiDiff copies", () => {
  it("leaves identical nominal declarations alone across the two copies", () => {
    for (const name of [
      "Priv",
      "Hash",
      "Prot",
      "makeP",
      "maybeP",
      "E",
      "sym",
      "useDep",
      "sameFn",
      "genericFn",
      "Box",
      "aliased",
    ])
      expect(kinds(".")).not.toHaveProperty(name);
  });

  it("widens an enum that gained a member and narrows one that lost it", () => {
    expect(kinds(".")).toMatchObject({ EC: "widened", ED: "narrowed" });
  });

  it("narrows a changed generic and a changed type of a dependency", () => {
    expect(kinds(".")).toMatchObject({ Box2: "narrowed", useDepB: "narrowed" });
  });

  it("narrows a name that lost its value and widens one that gained it", () => {
    expect(kinds(".")).toMatchObject({ GainsValue: "widened", LosesValue: "narrowed" });
  });
});

describe("apiDiff names, all together", () => {
  it("reports nothing else", () => {
    expect(Object.keys(kinds(".")).toSorted()).toStrictEqual(
      [
        "removedConst",
        "newConst",
        "widenParam",
        "widenReturn",
        "narrowParam",
        "Methods",
        "Widens",
        "Shape",
        "U",
        "PACKS",
        "Shrunk",
        "EC",
        "ED",
        "Opt",
        "Fields",
        "Loses",
        "Box2",
        "useDepB",
        "LosesValue",
        "GainsValue",
      ].toSorted(),
    );
  });
});

describe("apiDiff refusals", () => {
  it("names a types file that is not in the package", { timeout: TIMEOUT }, () => {
    const files = { "index.js": JS };
    const exports = {
      ".": conditions("./missing.d.ts", "./index.js"),
    };
    const version = { exports, files, version: "1.0.0" };
    const world = apiWorld(version, version);
    expect(() => apiDiff(world.project, world.old, world.next)).toThrow('cannot resolve "old" to a module');
  });
});
