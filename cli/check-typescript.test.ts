import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { removeTemps, tempDir } from "./__fixtures__/commit-repo.ts";
import { checkTypescript } from "./check-typescript.ts";

afterEach(removeTemps);

/** The package.json fields a test writes. */
type Manifest = {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
};

/** Writes `json` as the package.json in `dir`. */
function manifest(dir: string, json: Manifest): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(json));
}

/** A package dir that ships typescript 7.0.2. */
function pkgRoot(): string {
  const dir = tempDir();
  manifest(dir, { dependencies: { typescript: "7.0.2" }, name: "@workerstack/repo", version: "1.0.0" });

  return dir;
}

/** A consumer root that installs typescript `version`, listing it under `field`. */
function consumer(version: string | undefined, field: "dependencies" | "devDependencies" = "devDependencies"): string {
  const dir = tempDir();
  manifest(dir, { [field]: { typescript: version ?? "*" }, private: true });

  if (version !== undefined) manifest(path.join(dir, "node_modules", "typescript"), { name: "typescript", version });

  return dir;
}

describe("checkTypescript", () => {
  it("fails a typescript below 7 with the dev add that moves it", () => {
    expect(checkTypescript(consumer("5.9.3"), pkgRoot())).toStrictEqual([
      "typescript 5.9.3 is installed; repo needs typescript 7 or later; run `bun add -d typescript@7.0.2`",
    ]);
  });

  it("names the plain add when the root lists typescript under dependencies", () => {
    expect(checkTypescript(consumer("6.0.3", "dependencies"), pkgRoot())).toStrictEqual([
      "typescript 6.0.3 is installed; repo needs typescript 7 or later; run `bun add typescript@7.0.2`",
    ]);
  });

  it.each(["7.0.2", "7.1.0-dev.20261101", "8.0.0", "latest"])("passes typescript %s", (version) => {
    expect(checkTypescript(consumer(version), pkgRoot())).toStrictEqual([]);
  });

  it("passes a root with no typescript installed", () => {
    expect(checkTypescript(consumer(undefined), pkgRoot())).toStrictEqual([]);
  });

  it("passes an install whose package.json has no version", () => {
    const dir = consumer(undefined);
    manifest(path.join(dir, "node_modules", "typescript"), { name: "typescript" });
    expect(checkTypescript(dir, pkgRoot())).toStrictEqual([]);
  });
});

describe("checkTypescript, the version it names", () => {
  it("names typescript 7 when the package lists no typescript", () => {
    const pkg = tempDir();
    manifest(pkg, { name: "@workerstack/repo", version: "1.0.0" });
    expect(checkTypescript(consumer("5.9.3"), pkg)).toStrictEqual([
      "typescript 5.9.3 is installed; repo needs typescript 7 or later; run `bun add -d typescript@7`",
    ]);
  });

  it("names the dev add for a root with no package.json", () => {
    const dir = consumer("5.9.3");
    fs.rmSync(path.join(dir, "package.json"));
    expect(checkTypescript(dir, pkgRoot())).toStrictEqual([
      "typescript 5.9.3 is installed; repo needs typescript 7 or later; run `bun add -d typescript@7.0.2`",
    ]);
  });
});
