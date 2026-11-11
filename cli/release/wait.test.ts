import { describe, expect, it } from "vitest";

import { registryDoc, releaseWait } from "./wait.ts";

type Answer = () => Response | Error;
function doc(versions: string[], tags: Record<string, string>): Answer {
  const body = { "dist-tags": tags, versions: Object.fromEntries(versions.map((v) => [v, {}])) };
  return () => new Response(JSON.stringify(body));
}
function missing(): Response {
  return new Response("{}", { status: 404 });
}
function bad(): Response {
  return new Response("not json");
}
function offline(): Error {
  return new Error("offline");
}
function down(): Response {
  return new Response("down", { status: 503 });
}
function odd(): Response {
  return new Response('{"x":1}');
}
const SPEC = "@workerstack/repo@1.1.0-rc.0";

/** Runs `release wait`; `answers` are the registry's replies in order, the last repeating. */
async function wait(argv: string[], answers: Answer[]) {
  const out: string[] = [];
  const err: string[] = [];
  const urls: string[] = [];
  const sleeps: number[] = [];
  let clock = 0;
  function fetcher(url: string): Promise<Response> {
    urls.push(url);
    const got = (answers.length > 1 ? answers.shift() : answers[0])?.();
    return got instanceof Response ? Promise.resolve(got) : Promise.reject(got);
  }
  function sleep(ms: number): Promise<void> {
    clock += ms;
    sleeps.push(ms);
    return Promise.resolve();
  }
  const io = {
    fetch: fetcher,
    now: () => clock,
    sleep,
    stderr: (s: string) => err.push(s),
    stdout: (s: string) => out.push(s),
  };
  const code = await releaseWait(argv, io);
  return { code, err: err.join(""), out: out.join(""), sleeps, urls };
}

describe("repo release wait finds the version", () => {
  it("prints the version and its dist-tag when the registry has it at once", async () => {
    const got = await wait([SPEC], [doc(["1.0.0", "1.1.0-rc.0"], { latest: "1.0.0", next: "1.1.0-rc.0" })]);
    expect(got).toStrictEqual({
      code: 0,
      err: "",
      out: "published 1.1.0-rc.0 under next\n",
      sleeps: [],
      urls: ["https://registry.npmjs.org/@workerstack%2frepo"],
    });
  });

  it("prints just the version when no dist-tag points at it", async () => {
    const got = await wait(["@workerstack/database@0.22.0"], [doc(["0.22.0", "0.23.0"], { latest: "0.23.0" })]);
    expect(got).toMatchObject({ code: 0, out: "published 0.22.0\n" });
    expect(got.urls).toStrictEqual(["https://registry.npmjs.org/@workerstack%2fdatabase"]);
  });

  it("looks again every 10 seconds, through a miss, a failure and a bad body", async () => {
    const got = await wait([SPEC], [missing, offline, bad, doc(["1.1.0-rc.0"], { next: "1.1.0-rc.0" })]);
    expect(got).toMatchObject({ code: 0, out: "published 1.1.0-rc.0 under next\n" });
    expect(got.sleeps).toStrictEqual([10_000, 10_000, 10_000]);
  });
});

describe("repo release wait through a registry that does not answer", () => {
  it("keeps polling past a server error and an answer that is not a package", async () => {
    const got = await wait([SPEC], [down, odd, doc(["1.1.0-rc.0"], { next: "1.1.0-rc.0" })]);
    expect(got).toMatchObject({ code: 0, out: "published 1.1.0-rc.0 under next\n", sleeps: [10_000, 10_000] });
  });

  it("gives up after 15 minutes of server errors", async () => {
    const got = await wait([SPEC], [down]);
    expect(got).toMatchObject({ code: 1, out: "" });
    expect(got.sleeps).toHaveLength(90);
  });
});

describe("repo release wait gives up", () => {
  it("after 15 minutes without the version", async () => {
    const got = await wait([SPEC], [doc(["1.0.0"], { latest: "1.0.0" })]);
    expect(got.code).toBe(1);
    expect(got.out).toBe("");
    expect(got.err).toBe(
      "repo release wait: @workerstack/repo@1.1.0-rc.0 is not on npm after 15 minutes; " +
        "see gh run list --workflow release\n",
    );
    expect(got.sleeps).toHaveLength(90);
    expect(got.urls).toHaveLength(91);
  });

  it.each([[[]], [["@workerstack/repo"]], [["repo@"]], [["a", "b"]]])(
    "asks for <name>@<version> for the arguments %j",
    async (argv) => {
      const line = "repo release wait: name the tag as <name>@<version>, e.g. @workerstack/repo@1.0.0\n";
      expect(await wait(argv, [missing])).toMatchObject({ code: 1, err: line, out: "", urls: [] });
    },
  );
});

describe("registryDoc asks the registry it is given", () => {
  it("fetches from a given registry, and from npm when none is given", async () => {
    const urls: string[] = [];
    function fetcher(url: string): Promise<Response> {
      urls.push(url);
      return Promise.resolve(new Response("{}", { status: 404 }));
    }
    await registryDoc(fetcher, "@workerstack/repo", "http://localhost:4873/");
    await registryDoc(fetcher, "@workerstack/repo");
    expect(urls).toStrictEqual([
      "http://localhost:4873/@workerstack%2frepo",
      "https://registry.npmjs.org/@workerstack%2frepo",
    ]);
  });
});
