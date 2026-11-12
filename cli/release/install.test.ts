import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { removePlanted, tempDir, write } from "../__fixtures__/planted-repo.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { INSTALLED_DIR } from "./consumer.constants.ts";
import { addedName, addPeers, addSpecs, initProject, installedIn, installOld, renameOld } from "./install.ts";

afterEach(removePlanted);

function recording(code: number, stderr = ""): { bun: Runner; calls: string[][] } {
  const calls: string[][] = [];

  function bun(args: string[]) {
    calls.push(args);

    return { code, stderr, stdout: "" };
  }

  return { bun, calls };
}

describe("installOld", () => {
  it("adds the registry version under the old alias from the given registry", () => {
    const { bun, calls } = recording(0);
    const spec = { name: "@acme/fx", registry: "https://r.example/", version: "1.2.3" };
    expect(installOld(tempDir(), spec, { bun })).toBeNull();
    expect(calls).toStrictEqual([["add", "--registry", "https://r.example/", "old@npm:@acme/fx@1.2.3"]]);
  });

  it("adds a tarball under the old alias", () => {
    const { bun, calls } = recording(0);
    expect(installOld(tempDir(), { tarball: "/abs/old.tgz" }, { bun })).toBeNull();
    expect(calls).toStrictEqual([["add", "old@/abs/old.tgz"]]);
  });

  it("returns the first line of bun's error", () => {
    const { bun } = recording(1, "\nerror: 404 not found\nmore\n");
    expect(installOld(tempDir(), { tarball: "/x.tgz" }, { bun })).toBe("error: 404 not found");
  });

  it("returns an empty line when bun says nothing", () => {
    expect(installOld(tempDir(), { tarball: "/x.tgz" }, recording(1))).toBe("");
  });
});

describe("project helpers", () => {
  it("adds specs and reports bun's stderr on failure", () => {
    expect(addSpecs("/p", ["a", "b"], recording(0))).toBeNull();
    expect(addSpecs("/p", ["a"], recording(1, " boom \n"))).toBe("boom");
  });

  it("reads the added and installed packages and adds the peers it lists", () => {
    const project = tempDir();
    write(project, {
      "package.json": { dependencies: { "@a/x": "file:x" }, name: "c" },
      [`${INSTALLED_DIR}/@a/x/package.json`]: { name: "@a/x", peerDependencies: { p: "^1" }, version: "1.0.0" },
    });
    expect(addedName(project)).toBe("@a/x");
    const pkg = installedIn(project, "@a/x");
    expect(pkg.root).toBe(path.join(project, INSTALLED_DIR, "@a/x"));
    expect(pkg.installed.version).toBe("1.0.0");
    const { bun, calls } = recording(0);
    expect(addPeers(project, pkg, { bun })).toBeNull();
    expect(calls).toStrictEqual([["add", "p@^1"]]);
    expect(addPeers(project, { ...pkg, installed: { ...pkg.installed, peerDependencies: {} } }, { bun })).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("initProject writes a private manifest", () => {
    const project = tempDir();
    initProject(project);
    expect(JSON.parse(fs.readFileSync(path.join(project, "package.json"), "utf8"))).toStrictEqual({
      name: "consumer-test",
      private: true,
    });
  });
});

describe("renameOld", () => {
  it("names the old copy old and keeps the rest of its manifest", () => {
    const project = tempDir();
    write(project, { [`${INSTALLED_DIR}/old/package.json`]: { name: "@a/x", version: "1.0.0" } });
    renameOld(project);
    expect(installedIn(project, "old").installed.version).toBe("1.0.0");
    const text = fs.readFileSync(path.join(project, INSTALLED_DIR, "old", "package.json"), "utf8");
    expect(JSON.parse(text)).toStrictEqual({ name: "old", version: "1.0.0" });
  });
});
