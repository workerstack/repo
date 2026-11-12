import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { tempDir } from "../../sync/__fixtures__/temp-dirs.ts";
import type { SpawnFn } from "../google-workspace.types.ts";
import { isRecord } from "../../json.ts";

/** A planted home for one case. Bun's `os.homedir` ignores env changes, so the call is spied; callers restore with `vi.restoreAllMocks()`. */
export function plantHome(prefix: string): string {
  const home = tempDir(prefix);
  vi.spyOn(os, "homedir").mockReturnValue(home);
  return home;
}

export function jsonRes(obj: unknown, status = 200) {
  const body = JSON.stringify(obj);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(obj),
  };
}

export function textRes(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve<unknown>(JSON.parse(body)),
  };
}

export function writeJson(p: string, obj: unknown) {
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", { mode: 0o600 });
}

/** Undoes its global stubs and spies. */
export function resetCase(): void {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
}

/** A planted home whose default account holds a fresh token. */
export function plantLoggedIn(prefix: string): string {
  const home = plantHome(prefix);
  writeJson(storePath(home), freshToken());
  return home;
}

export function freshToken() {
  return {
    refresh_token: "rt",
    client_id: "cid",
    client_secret: "cs",
    access_token: "at",
    expiry_date: Date.now() + 3_600_000,
  };
}

export function storePath(home: string, account = "default") {
  return path.join(home, ".workerstack", "workspace", account, "tokens.json");
}

/** Capture stdout and stderr around one call; restores both when it settles. */
export async function withIo(fn: () => Promise<number>) {
  const logs: string[] = [];
  const errs: string[] = [];
  const out = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
    logs.push(String(s));
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((s) => {
    errs.push(String(s));
    return true;
  });
  try {
    const code = await fn();
    return { code, logs: logs.join(""), errs: errs.join("") };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

type Reply = { ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> };

export function stubFetch(handler: (url: string, init?: RequestInit) => Reply | Promise<Reply>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    return Promise.resolve(handler(u, init));
  });
  return calls;
}

/** The planted file's JSON object. */
export function readObject(p: string): Record<string, unknown> {
  const v: unknown = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!isRecord(v)) throw new Error(`${p} is not a JSON object`);
  return v;
}

type Call = { url: string; init?: RequestInit };

/** The i-th recorded fetch call; the case fails if there was none. */
export function callAt(calls: Call[], i: number): Call {
  const c = calls[i];
  if (!c) throw new Error(`no fetch call ${i}; got ${calls.length}`);
  return c;
}

/** The i-th call's request body as a JSON object. */
export function sentJson(calls: Call[], i = 0): Record<string, unknown> {
  const v: unknown = JSON.parse(String(callAt(calls, i).init?.body));
  if (!isRecord(v)) throw new Error("request body is not a JSON object");
  return v;
}

/** The i-th call's form-encoded body. */
export function sentForm(calls: Call[], i = 0): URLSearchParams {
  return new URLSearchParams(String(callAt(calls, i).init?.body));
}

/** A fetch that always fails with `reason`. */
export function stubFetchThrowing(reason: unknown) {
  vi.stubGlobal("fetch", () => Promise.reject(reason));
}


export interface Spawned {
  cmd: string;
  args: string[];
}

/** A spawn that plays the browser: it opens the consent URL's redirect with `query`. */
export function browser(query: string, seen: Spawned[] = []): SpawnFn {
  return (cmd, args) => {
    seen.push({ cmd, args });
    const consent = args.find((a) => a.startsWith("https://accounts.google.com/"));
    const redirect = consent ? new URL(consent).searchParams.get("redirect_uri") : null;
    if (redirect) http.get(`${redirect}/?${query}`, { agent: false }, (res) => res.resume());
    return { status: 0 };
  };
}

/** A Desktop OAuth JSON under `home`, with the client under `shape`. */
export function plantCreds(home: string, kind: "installed" | "web" = "installed"): string {
  const file = path.join(home, "oauth.json");
  writeJson(file, { [kind]: { client_id: "cid", client_secret: "cs" } });
  return file;
}
