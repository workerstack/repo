import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { setupJev } from "./setup.ts";
import { captureIo, cleanSetup, plant, spyStd } from "./fixtures/setup-kit.ts";

afterEach(cleanSetup);

it("setupJev prompts for the key on a terminal and fails when the answer is blank", async () => {
  const home = plant("setup-jev-tty-");
  const io = { ...captureIo(), password: () => Promise.resolve(" ts_key ") };
  const r = await setupJev({ home, io, interactive: true });
  expect(JSON.parse(fs.readFileSync(r.dest, "utf8"))).toStrictEqual({ apiKey: "ts_key" });
  const blank = { ...captureIo(), password: () => Promise.resolve("") };
  await expect(setupJev({ home, io: blank, interactive: true })).rejects.toThrow("need a TypeSafe API key");
});

it("setupJev accepts --key, names the flag when not interactive, and defaults to the stubbed home", async () => {
  const home = plant("setup-jev-flag-", true);
  const std = spyStd();
  const r = await setupJev({ flags: { key: "k1" } });
  expect(r.dest).toBe(path.join(home, ".workerstack", "jev.json"));
  expect(std.out.join("")).toContain(`wrote ${r.dest}`);
  await expect(setupJev()).rejects.toThrow(/need --api-key/);
});
