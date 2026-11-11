import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { captureIo, cleanSetup, plant, readJsonAt, spyStd } from "./__fixtures__/setup-kit.ts";
import { normalizeTarget } from "./setup-argv.ts";
import { setupJev } from "./setup-jev.ts";

afterEach(cleanSetup);

it("setupJev prompts for the key on a terminal and fails when the answer is blank", async () => {
  const home = plant("setup-jev-tty-");
  const io = { ...captureIo(), password: () => Promise.resolve(" ts_key ") };
  const r = await setupJev({ home, interactive: true, io });
  expect(JSON.parse(fs.readFileSync(r.dest, "utf8"))).toStrictEqual({ apiKey: "ts_key" });
  const blank = { ...captureIo(), password: () => Promise.resolve("") };
  await expect(setupJev({ home, interactive: true, io: blank })).rejects.toThrow("need a TypeSafe API key");
});

it("setupJev accepts --key, names the flag when not interactive, and defaults to the stubbed home", async () => {
  const home = plant("setup-jev-flag-", true);
  const std = spyStd();
  const r = await setupJev({ flags: { key: "k1" } });
  expect(r.dest).toBe(path.join(home, ".workerstack", "jev.json"));
  expect(std.out.join("")).toContain(`wrote ${r.dest}`);
  await expect(setupJev()).rejects.toThrow(/need --api-key/);
});

it("writes jev.json mode 0600 and does not echo the key", async () => {
  const home = plant("setup-jev-");
  const io = captureIo();
  const secret = "ts_live_do_not_print";
  const r = await setupJev({ flags: { "api-key": secret }, home, io });
  expect(r.ok).toBe(true);
  expect(readJsonAt(r.dest).apiKey).toBe(secret);
  const mode = fs.statSync(r.dest).mode & 0o777;
  expect(mode).toBe(process.platform === "win32" ? mode : 0o600);

  expect(io.logs.join("\n")).not.toContain(secret);
  expect(normalizeTarget("jev")).toBe("jev");
});
