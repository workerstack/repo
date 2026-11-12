import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempTree } from "./__fixtures__/temp-tree.ts";
import { checkLatestAt, latestRegistry } from "./check-latest.ts";

const plant = useTempTree("check-latest-");
const MANIFEST = "node_modules/@workerstack/repo/package.json";

/** A project directory with `@workerstack/repo` installed at `version`, or not installed at all. */
function project(version: string | null): string {
  return plant(version === null ? {} : { [MANIFEST]: JSON.stringify({ name: "@workerstack/repo", version }) });
}

const REGISTRY = "https://registry.example/";

function latestDoc(latest: string): Response {
  return new Response(JSON.stringify({ "dist-tags": { latest }, versions: { [latest]: {} } }));
}

/** Runs the check against a fake fetch answering `answer`; returns the result and the requests it saw. */
async function check(version: string | null, answer: () => Response | Error, registry = REGISTRY) {
  const calls: { url: string; signal: AbortSignal | undefined | null }[] = [];

  function fetcher(url: string, init?: { signal?: AbortSignal | null }): Promise<Response> {
    calls.push({ signal: init?.signal, url });
    const got = answer();

    return got instanceof Response ? Promise.resolve(got) : Promise.reject(got);
  }

  const result = await checkLatestAt(project(version), fetcher, registry);

  return { ...result, calls };
}

function skipped(why: string) {
  return `could not ask npm for the latest @workerstack/repo (${why}); the version check is skipped`;
}

function noTag() {
  return new Response(JSON.stringify({ "dist-tags": {}, versions: {} }));
}

function fetchLatest() {
  return Promise.resolve(latestDoc("0.2.0"));
}

describe("repo check compares the installed @workerstack/repo with npm's latest", () => {
  it("reports a problem when the install is behind", async () => {
    const got = await check("0.1.0", () => latestDoc("0.2.0"));
    expect(got.problems).toStrictEqual([
      "@workerstack/repo 0.1.0 is behind 0.2.0 on npm; run `bun update @workerstack/repo` and `bun repo sync`",
    ]);
    expect(got.report).toStrictEqual([]);
  });

  it.each(["0.2.0", "0.3.0"])("says nothing when the install is %s against a latest of 0.2.0", async (version) => {
    expect(await check(version, () => latestDoc("0.2.0"))).toMatchObject({ problems: [], report: [] });
  });
});

describe("repo check skips the comparison quietly", () => {
  it("never fetches when the package is not installed", async () => {
    const got = await check(null, () => latestDoc("9.9.9"));
    expect(got).toStrictEqual({ calls: [], problems: [], report: [] });
  });

  it.each<[string, () => Response | Error, string]>([
    ["a 404", () => new Response("{}", { status: 404 }), "not found"],
    ["an HTTP 500", () => new Response("{}", { status: 500 }), "HTTP 500"],
    ["a throw", () => new Error("fetch failed"), "fetch failed"],
    ["a timeout", () => new DOMException("The operation timed out.", "TimeoutError"), "The operation timed out."],
  ])("skips with a report line, not a problem, on %s", async (_name, answer, why) => {
    expect(await check("0.1.0", answer)).toMatchObject({ problems: [], report: [skipped(why)] });
  });

  it("skips when the registry lists no latest tag", async () => {
    expect(await check("0.1.0", noTag)).toMatchObject({ problems: [], report: [skipped("no latest tag")] });
  });
});

describe("repo check asks npm", () => {
  it("asks the registry it is given, with a timeout signal", async () => {
    const got = await check("0.1.0", () => latestDoc("0.1.0"), "http://localhost:4873");
    expect(got.calls.map((call) => call.url)).toStrictEqual(["http://localhost:4873/@workerstack%2frepo"]);
    expect(got.calls[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(["{}", "nope"])("says nothing when the installed manifest is %s", async (manifest) => {
    const dir = project("0.1.0");
    fs.writeFileSync(path.join(dir, MANIFEST), manifest);
    expect(await checkLatestAt(dir, fetchLatest, REGISTRY)).toStrictEqual({ problems: [], report: [] });
  });
});

describe("latestRegistry picks the registry bun installs from", () => {
  it("prefers BUN_CONFIG_REGISTRY, then NPM_CONFIG_REGISTRY, then npm", () => {
    expect(latestRegistry({ BUN_CONFIG_REGISTRY: "http://a/", NPM_CONFIG_REGISTRY: "http://b/" })).toBe("http://a/");
    expect(latestRegistry({ NPM_CONFIG_REGISTRY: "http://b/" })).toBe("http://b/");
    expect(latestRegistry({})).toBe("https://registry.npmjs.org/");
  });
});
