import { afterEach, expect, it, vi } from "vitest";

import { captureIo, cleanSetup, plant, spyStd } from "./__fixtures__/setup-kit.ts";
import { setupBrowser } from "./setup-browser.ts";
import { targetStatuses } from "./setup-status.ts";

afterEach(cleanSetup);

function has(...names: string[]) {
  return (n: string) => (names.includes(n) ? `/bin/${n}` : "");
}

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
  expect(io.logs.at(-1)).toBe("session: .repo/tmp/browser/");
});

it("setupBrowser prints no advice when neither engine is found", async () => {
  const io = captureIo();
  await setupBrowser({ io, pathEnv: "/bin", platform: "linux", whichFn: has() });
  expect(io.logs.at(-1)).toBe("session: .repo/tmp/browser/");
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

it("prints install hints when engines are missing", async () => {
  const io = captureIo();
  const r = await setupBrowser({ io, pathEnv: "/none", platform: "linux", whichFn: () => "" });
  expect(r.ok).toBe(false);
  expect(io.logs.join("\n")).toMatch(/lightpanda missing/);
  expect(io.logs.join("\n")).toMatch(/chromium missing/);
  expect(io.logs.join("\n")).toMatch(/\.repo\/tmp\/browser/);
});

it("chromium-only on linux is not done; advises Lightpanda", async () => {
  const io = captureIo();

  const r = await setupBrowser({
    io,
    pathEnv: "/none",
    platform: "linux",
    whichFn: (name: string) => (name === "chromium" ? "/home/dev/bin/chromium" : ""),
  });

  expect(r.ok).toBe(false);
  expect(r.chromium).toBe("/home/dev/bin/chromium");
  expect(io.logs.join("\n")).toMatch(/Install Lightpanda as well/);

  const st = await targetStatuses({
    env: {},
    home: plant("setup-br-st-"),
    pathEnv: "/none",
    platform: "linux",
    whichFn: (name: string) => (name === "chromium" ? "/home/dev/bin/chromium" : ""),
  });

  expect(st.browser.ok).toBe(false);
  expect(st.browser.extra).toMatch(/need lightpanda/);
});

it("re-checks PATH after install confirm", async () => {
  let n = 0;
  const io = { ...captureIo(), confirm: () => Promise.resolve(true) };

  const r = await setupBrowser({
    interactive: true,
    io,
    pathEnv: "/none",
    platform: "linux",
    whichFn: (name: string) => {
      if (name === "lightpanda") {
        n += 1;

        return n > 1 ? "/usr/bin/lightpanda" : "";
      }

      return "";
    },
  });

  expect(r.lightpanda).toBe("/usr/bin/lightpanda");
  expect(io.logs.join("\n")).toMatch(/lightpanda ok/);
  expect(io.logs.join("\n")).toMatch(/chromium still missing/);
});
