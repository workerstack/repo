import { afterEach, expect, it, vi } from "vitest";

import { captureIo, cleanSetup, plant, spyStd } from "./fixtures/setup-kit.ts";
import { setupBrowser } from "./setup.ts";

afterEach(cleanSetup);

const has =
  (...names: string[]) =>
  (n: string) =>
    names.includes(n) ? `/bin/${n}` : "";

it("setupBrowser reports both engines", async () => {
  const io = captureIo();
  const r = await setupBrowser({ io, pathEnv: "/bin", platform: "linux", whichFn: has("lightpanda", "chromium") });
  expect(r).toStrictEqual({ chromium: "/bin/chromium", lightpanda: "/bin/lightpanda", ok: true });
  expect(io.logs.at(-1)).toBe("browser ok  lightpanda (default) + chromium (fallback)");
});

it("setupBrowser advises a chromium family browser when only Lightpanda is found", async () => {
  const io = captureIo();
  const r = await setupBrowser({ io, pathEnv: "/bin", platform: "linux", whichFn: has("lightpanda") });
  expect(r.ok).toBe(false);
  expect(io.logs.at(-1)).toMatch(/^Lightpanda ok\. Install a chromium-family/);
});

it("setupBrowser is done on Windows with chromium alone and prints no advice", async () => {
  const io = captureIo();
  const r = await setupBrowser({ io, pathEnv: "/bin", platform: "win32", whichFn: has("chromium") });
  expect(r.ok).toBe(true);
  expect(io.logs.at(-1)).toBe("session: .tmp/repo/browser/");
});

it("setupBrowser prints no advice when neither engine is found", async () => {
  const io = captureIo();
  await setupBrowser({ io, pathEnv: "/bin", platform: "linux", whichFn: has() });
  expect(io.logs.at(-1)).toBe("session: .tmp/repo/browser/");
});

it("setupBrowser leaves an engine missing when the user declines the re-check or it still is not there", async () => {
  const no = { ...captureIo(), confirm: () => Promise.resolve(false) };
  await setupBrowser({ interactive: true, io: no, pathEnv: "/bin", platform: "linux", whichFn: has() });
  expect(no.logs.join("\n")).not.toContain("still missing");
  const yes = { ...captureIo(), confirm: () => Promise.resolve(true) };
  await setupBrowser({ interactive: true, io: yes, pathEnv: "/bin", platform: "linux", whichFn: has() });
  expect(yes.logs.filter((l) => l.endsWith("still missing"))).toHaveLength(2);
});

it("setupBrowser with no context reads the process PATH and prints to stdout", async () => {
  vi.stubEnv("PATH", plant("setup-br-empty-"));
  const std = spyStd();
  const r = await setupBrowser();
  expect(r.ok).toBe(false);
  expect(std.out.join("")).toContain("lightpanda missing");
});
