import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, it } from "vitest";

import { bunPath } from "../../dev/test-paths";
import { childEnv } from "../env.ts";
import { captureIo, cleanSetup, enablePacks, plant, readSpeakJson } from "./__fixtures__/setup-kit.ts";
import { mergeSpeakJson } from "./setup-files.ts";
import { OPENAI_KEY_URL, USAGE } from "./setup.constants.ts";
import { main } from "./setup.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoCli = path.join(here, "..", "..", "bin", "repo.ts");
const ALL_PACKS = ["speak", "listen", "google-workspace", "clasp"];
const bareLinux = { pathEnv: "/none", platform: "linux" as const, whichFn: () => "" };

afterEach(cleanSetup);

it("no target non-interactive prints usage", async () => {
  const io = captureIo();

  const code = await main([], {
    env: { CI: "1" },
    home: plant("setup-main-"),
    interactive: false,
    io,
    stdin: { isTTY: false },
    stdout: { isTTY: false },
    ...bareLinux,
  });

  expect(code).toBe(1);
  expect(io.errs.join("\n")).toContain("usage: setup");
});

it("TTY menu labels include status and prefers first missing", async () => {
  const home = plant("setup-menu-");
  const cwd = enablePacks(plant("setup-menu-cwd-"), ALL_PACKS);
  mergeSpeakJson(home, { elevenlabs: { apiKey: "sk_el" } });

  const io = {
    ...captureIo(),
    select: (opts: { options: { value: string; label: string }[]; initialValue: string }) => {
      expect(opts.initialValue).toBe("listen");
      expect(opts.options[0]?.label).toMatch(/ok/);
      expect(opts.options[1]?.label).toMatch(/missing/);

      return Promise.resolve("browser");
    },
  };

  const code = await main([], { cwd, env: { HOME: home }, home, interactive: true, io, ...bareLinux });
  expect(code).toBe(0);
  expect(io.logs.join("\n")).toMatch(/browser  missing/);
});

it("skips already-ok speak unless redo", async () => {
  const home = plant("setup-skip-");
  const cwd = enablePacks(plant("setup-skip-cwd-"), ["speak"]);
  mergeSpeakJson(home, { openai: { apiKey: "sk_old" } });
  const io = { ...captureIo(), confirm: () => Promise.resolve(false) };
  const code = await main(["speak"], { cwd, env: { HOME: home }, home, interactive: true, io, ...bareLinux });
  expect(code).toBe(0);
  expect(io.logs.join("\n")).toMatch(/skip speak/);
});

it("speak flag path through main", async () => {
  const home = plant("setup-main-speak-");
  const cwd = enablePacks(plant("setup-main-speak-cwd-"), ["speak"]);
  const io = captureIo();
  const argv = ["speak", "--elevenlabs-key", "sk_m", "--skip-verify"];
  const code = await main(argv, { cwd, env: { HOME: home }, home, interactive: false, io, ...bareLinux });
  expect(code).toBe(0);
  expect(readSpeakJson(home).elevenlabs?.apiKey).toBe("sk_m");
});

it("menu without a features file lists browser and jev only", async () => {
  const cwd = plant("setup-menu-off-");

  const io = {
    ...captureIo(),
    select: (opts: { options: { value: string }[] }) => {
      expect(opts.options.map((o) => o.value)).toStrictEqual(["browser", "jev"]);

      return Promise.resolve("browser");
    },
  };

  const code = await main([], { cwd, home: plant("setup-menu-off-home-"), interactive: true, io, ...bareLinux });
  expect(code).toBe(0);
});

it("a disabled pack prints how to enable it", async () => {
  const io = captureIo();

  const code = await main(["listen"], {
    cwd: plant("setup-listen-off-"),
    env: { CI: "1" },
    home: plant("setup-listen-off-home-"),
    interactive: false,
    io,
    ...bareLinux,
  });

  expect(code).toBe(1);
  expect(io.errs.join("\n")).toMatch(/agents\.skills/);
  expect(io.errs.join("\n")).toMatch(/bun repo sync/);
});

it("CLI no args exits 1", () => {
  const r = spawnSync(bunPath(), [repoCli, "setup"], {
    encoding: "utf8",
    env: childEnv({ CI: "1" }),
    timeout: 15_000,
  });

  expect(r.status).toBe(1);
  expect(`${r.stdout}${r.stderr}`).toContain("usage: setup");
  expect(USAGE).toMatch(/speak/);
  expect(OPENAI_KEY_URL).toMatch(/openai/);
});
