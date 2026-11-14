import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { removeTree } from "../remove-tree.ts";
import { useTempDirs } from "../sync/__fixtures__/temp-dirs.ts";
import {
  freshToken,
  jsonRes,
  plantHome,
  storePath,
  stubFetch,
  stubFetchThrowing,
  withIo,
  writeJson,
} from "./__fixtures__/google-workspace-kit.ts";
import { main } from "./google-workspace.ts";

useTempDirs();

let home = "";

beforeEach(() => {
  home = plantHome("ws-accounts-");
  writeJson(storePath(home), freshToken());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function run(...argv: string[]) {
  return withIo(() => main(argv));
}

it("accounts: lists named accounts with what each holds and skips stray entries", async () => {
  const root = path.join(home, ".workerstack", "workspace");
  writeJson(path.join(root, "work", "google-oauth.json"), {});
  writeJson(path.join(root, "home", "tokens.json"), freshToken());
  fs.mkdirSync(path.join(root, "bad name"), { recursive: true });
  fs.writeFileSync(path.join(root, "stray.txt"), "");
  const r = await run("accounts");
  expect(r.logs).toBe("default  -  tokens\nhome  -  tokens\nwork  oauth  -\n");
});

it("accounts: says when nothing is stored", async () => {
  removeTree(path.join(home, ".workerstack"));
  const r = await run("accounts");
  expect(r.logs).toBe("no accounts\n");
});

it("accounts: selects one by flag or WORKSPACE_ACCOUNT", async () => {
  writeJson(storePath(home, "work"), { ...freshToken(), access_token: "work-at" });
  writeJson(storePath(home, "env"), { ...freshToken(), access_token: "env-at" });
  const seen: string[] = [];
  stubFetch((_url, init) => {
    seen.push(JSON.stringify(init?.headers));

    return jsonRes({ email: "x" });
  });
  await run("--account", "work", "whoami");
  vi.stubEnv("WORKSPACE_ACCOUNT", "env");
  await run("whoami");
  expect(seen[0]).toContain("Bearer work-at");
  expect(seen[1]).toContain("Bearer env-at");
});

it("main: prints usage with no verb and matches verbs in any case", async () => {
  const usage = await run();
  expect(usage.errs).toContain("usage: google-workspace");
  stubFetch(() => jsonRes({ email: "me@x" }));
  const who = await run("WhoAmI");
  expect(who.logs).toBe("me@x\n");
});

it("main: reports a failure whatever was thrown", async () => {
  stubFetchThrowing(new Error("offline"));
  const offline = await run("whoami");
  expect(offline.errs).toBe("offline\n");
  stubFetchThrowing("plain text");
  const plain = await run("whoami");
  expect(plain.errs).toBe("plain text\n");
  stubFetchThrowing(new Error(""));
  const blank = await run("whoami");
  expect(blank.errs).toBe("Error\n");
  stubFetchThrowing({ code: 7 });
  const opaque = await run("whoami");
  expect(opaque.errs).toBe("[object Object]\n");
});
