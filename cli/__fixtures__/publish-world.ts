import { releasePublish } from "../release/publish.ts";
import { spawnRunner } from "../scripts/ci-wait-run.ts";
import type { Runner } from "../scripts/ci-wait.ts";
import { NAME, type World } from "./release-world.ts";

const DOC_URL = "https://registry.npmjs.org/@acme%2fapp";
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });

/** What the fake registry holds: the package, a listed version, and how many tarball requests answer 404 first or fail. */
export type Registry = { exists: boolean; listed: boolean; notServed: number; offline?: number; docFails?: number };
/** What the fake npm does on `publish`: its exit code, and whether the version is listed afterwards. */
export type Npm = { code: number; lists: boolean };
export type Options = { ci?: boolean; npm?: Npm; packed?: { name: string; version: string }; bun?: Runner };

/** A fetch over `registry` for `version` that records the urls it was asked for. */
function registryFetch(registry: Registry, version: string, urls: string[]): (url: string) => Promise<Response> {
  return (url) => {
    urls.push(url);
    if (url === DOC_URL && (registry.docFails ?? 0) > 0) {
      registry.docFails = (registry.docFails ?? 0) - 1;
      return Promise.resolve(new Response("down", { status: 503 }));
    }
    if (url === DOC_URL) {
      const body = registry.exists
        ? { versions: registry.listed ? { [version]: {} } : { "0.0.1": {} }, "dist-tags": { latest: "0.0.1" } }
        : {};
      return Promise.resolve(new Response(JSON.stringify(body), { status: registry.exists ? 200 : 404 }));
    }
    if ((registry.offline ?? 0) > 0) {
      registry.offline = (registry.offline ?? 0) - 1;
      return Promise.reject(new Error("offline"));
    }
    const served = registry.notServed <= 0;
    registry.notServed -= 1;
    return Promise.resolve(new Response("tgz", { status: served ? 200 : 404 }));
  };
}

/** Runs `release publish` in the world's checkout against fakes of bun, tar, npm and the registry. */
export async function publish(w: World, argv: string[], registry: Registry, options: Options = {}) {
  const version = (argv[0] ?? "").split("@").pop() ?? "";
  const out: string[] = [];
  const err: string[] = [];
  const npmCalls: string[] = [];
  const urls: string[] = [];
  const sleeps: number[] = [];
  const bunCalls: string[] = [];
  const npm: Runner = (args) => {
    npmCalls.push(args.join(" "));
    registry.listed = registry.listed || (options.npm?.lists ?? true);
    return { code: options.npm?.code ?? 0, stdout: "", stderr: "" };
  };
  let clock = 0;
  const code = await releasePublish(argv, {
    cwd: w.work,
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    git: spawnRunner("git"),
    bun: options.bun ?? ((args) => (bunCalls.push(args.join(" ")), ok())),
    tar: () => ok(JSON.stringify(options.packed ?? { name: NAME, version })),
    npm,
    fetch: registryFetch(registry, version, urls),
    now: () => clock,
    sleep: (ms) => ((clock += ms), sleeps.push(ms), Promise.resolve()),
    ci: options.ci ?? false,
    tmp: "/tmp",
    mkdtemp: (prefix) => `${prefix}x1`,
    list: () => [`acme-app-${version}.tgz`],
  });
  return { code, out: out.join(""), err: err.join(""), npmCalls, bunCalls, urls, sleeps };
}
