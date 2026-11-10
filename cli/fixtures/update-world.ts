import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { UpdateIo } from "../update-io.types.ts";
import type { PackageJson } from "../sync/workspace.ts";
import { REGISTRY } from "../release/release.constants.ts";

/** What the fake registry answers for a name: a `latest` version, a 404, a document with no `latest`, or a timeout. */
export type Reply = string | { status: 404 } | { noLatest: true } | { timeout: true };

export const NOT_FOUND: Reply = { status: 404 };
export const NO_LATEST: Reply = { noLatest: true };
export const TIMEOUT: Reply = { timeout: true };

const made: string[] = [];

/** Removes every temp workspace the test made; run it after each test. */
export function cleanup(): void {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

/** The reply as the registry's document for one package. */
function answer(reply: Reply): Response {
  if (typeof reply === "string") return Response.json({ versions: {}, "dist-tags": { latest: reply } });
  if ("status" in reply) return new Response("", { status: reply.status });
  if ("timeout" in reply) throw new Error("timeout");
  return Response.json({ versions: {}, "dist-tags": {} });
}

/** A temp workspace of JSON files (keys are root-relative POSIX paths) with a fake registry and captured streams. */
export function world(files: Record<string, unknown>, replies: Record<string, Reply>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repo-update-"));
  made.push(root);
  for (const [rel, value] of Object.entries(files)) {
    const file = path.join(root, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }
  fs.writeFileSync(path.join(root, ".oxfmtrc.jsonc"), "{}\n");
  const state = {
    root,
    out: [] as string[],
    err: [] as string[],
    asked: [] as string[],
    peak: 0,
    installs: [] as string[],
    formats: [] as { root: string; files: string[]; seen: string[] }[],
  };
  let inflight = 0;
  const fetcher: UpdateIo["fetch"] = async (url) => {
    const name = decodeURIComponent(url.slice(REGISTRY.length));
    state.asked.push(name);
    inflight += 1;
    state.peak = Math.max(state.peak, inflight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inflight -= 1;
    return answer(replies[name] ?? NOT_FOUND);
  };
  const io = (over: Partial<UpdateIo> = {}): UpdateIo => ({
    cwd: root,
    env: {},
    out: (line) => state.out.push(line),
    err: (line) => state.err.push(line),
    fetch: fetcher,
    install: (dir) => {
      state.installs.push(dir);
      return { code: 0, output: "" };
    },
    format: (dir, list) => {
      state.formats.push({ root: dir, files: list, seen: list.map((f) => fs.readFileSync(path.join(dir, f), "utf8")) });
      return { code: 0, output: "" };
    },
    ...over,
  });
  const read = (rel: string): PackageJson => JSON.parse(fs.readFileSync(path.join(root, ...rel.split("/")), "utf8")) /* a manifest this fixture wrote */ as PackageJson;
  return Object.assign(state, { io, read });
}
