import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createJevRunner, main, runJev } from "./jev.ts";
import type { JevRunOpts } from "./jev.ts";
import {
  KEY,
  QUESTIONS,
  answerBody,
  captureStdout,
  plantDir,
  readLedgerFile,
  reply,
  scripted,
} from "./fixtures/jev-kit.ts";

afterEach(() => vi.restoreAllMocks());

function plantInputs(dir: string) {
  const state = path.join(dir, "state.txt");
  const questions = path.join(dir, "questions.json");
  fs.writeFileSync(state, "state text");
  fs.writeFileSync(questions, QUESTIONS);
  return { state, questions };
}

it("the runner with defaults: answers usage when called with nothing", async () => {
  expect((await createJevRunner()()).text).toMatch(/^usage: /);
});

it("the runner with defaults: reads the process environment and the user's home", async () => {
  const home = plantDir();
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.stubEnv("TYPESAFE_API_KEY", KEY);
  const opts: JevRunOpts = {
    stateText: "s",
    questionsText: QUESTIONS,
    fetchImpl: scripted(reply(200, answerBody())),
  };
  expect((await createJevRunner()(opts)).code).toBe(0);
  expect(readLedgerFile(home).requests).toBe(1);
});

it("runJev: answers whether a key exists, from the process environment and home by default", async () => {
  vi.spyOn(os, "homedir").mockReturnValue(plantDir());
  vi.stubEnv("TYPESAFE_API_KEY", "");
  expect(await runJev(["--available"])).toEqual({ code: 0, text: "no\n" });
  vi.stubEnv("TYPESAFE_API_KEY", KEY);
  expect(await runJev(["--available"])).toEqual({ code: 0, text: "yes\n" });
});

it("runJev: needs both file flags", async () => {
  const outs = await Promise.all([[], ["--state", "a"], ["--questions", "b"]].map((argv) => runJev(argv, { env: {} })));
  expect(outs.every((out) => out.code === 2 && out.text.startsWith("usage: "))).toBe(true);
});

it("runJev: names the failure when a file cannot be read", async () => {
  const dir = plantDir();
  const { state } = plantInputs(dir);
  expect(await runJev(["--state", state, "--questions", path.join(dir, "missing.json")])).toEqual({
    code: 2,
    text: "state or questions file missing\n",
  });
});

it("runJev: hands the file contents and its options to the runner", async () => {
  const dir = plantDir();
  const { state, questions } = plantInputs(dir);
  const seen: JevRunOpts[] = [];
  const out = await runJev(["--state", state, `--questions=${questions}`], {
    home: dir,
    env: { TYPESAFE_API_KEY: KEY },
    now: 5,
    run: (opts) => {
      seen.push(opts ?? {});
      return Promise.resolve({ code: 0, text: "ok\n" });
    },
  });
  expect(out).toEqual({ code: 0, text: "ok\n" });
  expect(seen[0]).toMatchObject({
    home: dir,
    env: { TYPESAFE_API_KEY: KEY },
    now: 5,
    stateText: "state text",
    questionsText: QUESTIONS,
  });
});

it("main: prints the usage text and returns 2 when args are missing", async () => {
  const writes = captureStdout();
  expect(await main([])).toBe(2);
  expect(writes.join("")).toMatch(/^usage: /);
});

it("main: prints a one-line failure when the run throws", async () => {
  const dir = plantDir();
  const { state, questions } = plantInputs(dir);
  const home = path.join(dir, "home-is-a-file");
  fs.writeFileSync(home, "x");
  vi.spyOn(os, "homedir").mockReturnValue(home);
  vi.stubEnv("TYPESAFE_API_KEY", KEY);
  const writes = captureStdout();
  expect(await main(["--state", state, "--questions", questions])).toBe(2);
  expect(writes.join("")).toBe("jev request failed\n");
});

it("main: runs the shared runner once per process", async () => {
  const dir = plantDir();
  const { state, questions } = plantInputs(dir);
  const argv = ["--state", state, "--questions", questions];
  const opts = { home: dir, env: { TYPESAFE_API_KEY: KEY }, fetchImpl: scripted(reply(200, answerBody())) };
  const first = await runJev(argv, opts);
  expect(first.code).toBe(0);
  expect(await runJev(argv, opts)).toEqual({ code: 2, text: "process request cap 1\n" });
  expect(opts.fetchImpl.calls).toBe(1);
});
