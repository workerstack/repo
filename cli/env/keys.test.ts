import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { useTempTree } from "../__fixtures__/temp-tree.ts";
import {
  bunRuntime,
  homeDir,
  identities,
  packageRoot,
  readKeysFile,
  readPlaintexts,
  readRequest,
  stackFile,
} from "./keys.ts";

const plant = useTempTree("env-keys-");

// Fake identities, built so no real-looking age key sits in this file.
const PREFIX = ["AGE", "SECRET", "KEY", "1"].join("-");
const ALPHA = `${PREFIX}FAKEALPHA`;
const BETA = `${PREFIX}FAKEBETA`;
const FROM_ENV = `${PREFIX}FAKEFROMENV`;
const RECIPIENT = `age1${"q".repeat(58)}`;

const KEYS_DIR = ".workerstack/keys";
const KEYS_FILE = ".repo/env.keys.json";

/** A package.json named `name`. */
function manifest(name: string): string {
  return JSON.stringify({ name });
}

/** The identity file age-keygen writes: two comment lines, then the key. */
function keyFile(identity: string): string {
  return `# created: 2026-01-01T00:00:00Z\n# public key: ${RECIPIENT}\n${identity}\n`;
}

describe("identities", () => {
  it("reads WORKERSTACK_ENV_KEY when it is set, before any key file", () => {
    const home = plant({ [`${KEYS_DIR}/repo.key`]: keyFile(ALPHA) });
    expect(identities({ home, source: { WORKERSTACK_ENV_KEY: FROM_ENV } })).toStrictEqual([FROM_ENV]);
  });

  it("reads the key of every *.key file under ~/.workerstack/keys, comments skipped", () => {
    const home = plant({
      [`${KEYS_DIR}/a.key`]: keyFile(ALPHA),
      [`${KEYS_DIR}/b.key`]: keyFile(BETA),
      [`${KEYS_DIR}/notes.txt`]: keyFile(FROM_ENV),
    });
    expect(identities({ home, source: {} })).toStrictEqual([ALPHA, BETA]);
  });

  it("reads none when the keys folder is missing", () => {
    expect(identities({ home: plant({}), source: {} })).toStrictEqual([]);
  });
});

describe("readKeysFile", () => {
  const keys = JSON.stringify({ recipient: RECIPIENT, repo: "monorepo" });

  it("parses the keys file at cwd", () => {
    const dir = plant({ [KEYS_FILE]: keys });
    expect(readKeysFile(dir)).toStrictEqual({ recipient: RECIPIENT, repo: "monorepo" });
  });

  it("finds the nearest keys file above cwd", () => {
    const dir = plant({ [KEYS_FILE]: keys, "projects/anyrow/src/x.ts": "" });
    expect(readKeysFile(path.join(dir, "projects/anyrow/src"))).toStrictEqual({
      recipient: RECIPIENT,
      repo: "monorepo",
    });
  });

  it("is undefined when no keys file sits at or above cwd", () => {
    expect(readKeysFile(plant({ "a/b.txt": "" }))).toBeUndefined();
  });

  it.each([
    ["not JSON", "{"],
    ["no recipient", JSON.stringify({ repo: "monorepo" })],
    ["a recipient that is not age1", JSON.stringify({ recipient: "ssh-ed25519 AAAA", repo: "monorepo" })],
    ["no repo", JSON.stringify({ recipient: RECIPIENT })],
    ["an array", "[]"],
  ])("refuses a keys file with %s, naming the file", (_label, content) => {
    const dir = plant({ [KEYS_FILE]: content });
    expect(() => readKeysFile(dir)).toThrow(KEYS_FILE);
  });
});

describe("packageRoot", () => {
  it("finds the @workerstack/repo package above a nested module, past other packages", () => {
    const dir = plant({
      "pkg/dist/cli/env/keys.js": "",
      "pkg/dist/package.json": manifest("other"),
      "pkg/package.json": manifest("@workerstack/repo"),
    });
    const from = pathToFileURL(path.join(dir, "pkg/dist/cli/env/keys.js")).href;
    expect(packageRoot(from)).toBe(path.join(dir, "pkg"));
  });

  it("finds this package from its own module", () => {
    expect(packageRoot(import.meta.url)).toBe(path.resolve(import.meta.dirname, "../.."));
  });

  it("passes a package.json with no name", () => {
    const dir = plant({
      "pkg/package.json": manifest("@workerstack/repo"),
      "pkg/x/package.json": "{}",
      "pkg/x/y.js": "",
    });
    expect(packageRoot(pathToFileURL(path.join(dir, "pkg/x/y.js")).href)).toBe(path.join(dir, "pkg"));
  });

  it("refuses a module outside any @workerstack/repo package", () => {
    const dir = plant({ "x/package.json": manifest("other"), "x/y.js": "" });
    expect(() => packageRoot(pathToFileURL(path.join(dir, "x/y.js")).href)).toThrow("@workerstack/repo");
  });
});

describe("homeDir", () => {
  it("reads HOME, then USERPROFILE, then the fallback", () => {
    expect(homeDir({ HOME: "/h", USERPROFILE: "/u" }, "/f")).toBe("/h");
    expect(homeDir({ USERPROFILE: "/u" }, "/f")).toBe("/u");
    expect(homeDir({}, "/f")).toBe("/f");
  });
});

describe("bunRuntime", () => {
  it("runs this process under bun, else bun on PATH", () => {
    expect(bunRuntime({ bun: "1.4.4" }, "/bin/this")).toBe("/bin/this");
    expect(bunRuntime({ node: "24.0.0" }, "/bin/this")).toBe("bun");
  });
});

describe("stackFile", () => {
  const cwd = path.resolve("/repo");

  it.each([
    ["a named frame", `Error\n    at main (${path.resolve("/repo/projects/a/env.ts")}:3:14)\n    at other (/x.ts:1:1)`],
    ["an anonymous frame", `Error\n    at ${path.resolve("/repo/projects/a/env.ts")}:3:14`],
    ["a file URL frame", `Error\n    at ${pathToFileURL(path.resolve("/repo/projects/a/env.ts")).href}:3:14`],
  ])("names the file of %s relative to cwd", (_label, stack) => {
    expect(stackFile(stack, cwd)).toBe(path.join("projects", "a", "env.ts"));
  });

  it("is undefined for a stack with no frame", () => {
    expect(stackFile("Error", cwd)).toBeUndefined();
  });
});

describe("the decrypt child protocol", () => {
  it("parses a request of cipher and identity lists", () => {
    const text = JSON.stringify({ ciphers: ["YWdl"], identities: [ALPHA] });
    expect(readRequest(text)).toStrictEqual({ ciphers: ["YWdl"], identities: [ALPHA] });
  });

  it.each([
    ["not JSON", "{"],
    ["null", "null"],
    ["no ciphers", JSON.stringify({ identities: [] })],
    ["no identities", JSON.stringify({ ciphers: [] })],
    ["a cipher that is not text", JSON.stringify({ ciphers: [1], identities: [] })],
    ["identities that are not a list", JSON.stringify({ ciphers: [], identities: "x" })],
  ])("refuses a request with %s", (_label, text) => {
    expect(() => readRequest(text)).toThrow("repo env: the decrypt child takes");
  });

  it("parses as many plaintexts as ciphers", () => {
    expect(readPlaintexts(JSON.stringify(["one", "two"]), 2)).toStrictEqual(["one", "two"]);
  });

  it.each([
    ["a count that differs", JSON.stringify(["one"])],
    ["a list of other things", JSON.stringify([1, 2])],
    ["no JSON", ""],
  ])("refuses an answer with %s", (_label, text) => {
    expect(() => readPlaintexts(text, 2)).toThrow("repo env: the decrypt child did not answer 2 plaintexts");
  });
});
