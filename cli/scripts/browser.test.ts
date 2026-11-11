import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import { readEnv } from "../env.ts";
import { doctorHints, installHint, lookupBins, pickEngine } from "./browser-engine.ts";
import { sessionDir } from "./browser-session.ts";
import { isBlockedSnap, isPaintHost } from "./browser-snap.ts";
import { runBrowser } from "./browser.ts";
import { cleanBrowser, exec, failure, tmp } from "./fixtures/browser-kit.ts";

afterEach(cleanBrowser);

it("paint-host URLs", () => {
  expect(isPaintHost("https://www.figma.com/file/x")).toBe(true);
  expect(isPaintHost("https://docs.google.com/document/d/1")).toBe(true);
  expect(isPaintHost("https://docs.google.com/spreadsheets/d/1")).toBe(true);
  expect(isPaintHost("https://docs.google.com/presentation/d/1")).toBe(true);
  expect(isPaintHost("https://mail.google.com/mail/u/0/")).toBe(true);
  expect(isPaintHost("https://earth.google.com/web/")).toBe(true);
  expect(isPaintHost("https://www.amazon.com/dp/B0")).toBe(true);
  expect(isPaintHost("https://amazon.co.uk/")).toBe(true);
  expect(isPaintHost("https://example.com/")).toBe(false);
});

it("blocked/empty snaps", () => {
  expect(isBlockedSnap("# https://x/\n", [])).toBe(true);
  expect(isBlockedSnap("# https://x/\n\nhello", ["[1] link Home"])).toBe(false);
  expect(isBlockedSnap("Enable JavaScript to continue", ["[1] button ok"])).toBe(true);
  expect(isBlockedSnap("Sorry, we just need to make sure you're not a robot", [])).toBe(true);
});

it("win32 → chromium even if lightpanda present", () => {
  const r = pickEngine({
    bins: { chromium: "/x/chromium", lightpanda: "/x/lightpanda" },
    platform: "win32",
    url: "https://example.com/",
    verb: "nav",
  });
  expect(r.engine).toBe("chromium");
});

it("shot/pdf/trace → chromium", () => {
  const bins = { chromium: "/x/chromium", lightpanda: "/x/lightpanda" };
  expect(pickEngine({ bins, platform: "linux", verb: "shot" }).engine).toBe("chromium");
  expect(pickEngine({ bins, platform: "linux", verb: "pdf" }).engine).toBe("chromium");
  expect(pickEngine({ bins, platform: "linux", verb: "trace" }).engine).toBe("chromium");
});

it("defaults to the host's platform and to a nav of no url with no engines", () => {
  const bins = { chromium: "/x/chromium", lightpanda: "/x/lightpanda" };
  expect(pickEngine({ bins })).toStrictEqual(pickEngine({ bins, platform: process.platform }));
  expect(pickEngine()).toStrictEqual(pickEngine({ bins: {}, platform: process.platform, url: "", verb: "nav" }));
});

it("knows the paint hosts, their subdomains, and the google earth path", () => {
  const hosts = ["figma", "docs.google", "sheets.google", "slides.google", "mail.google", "earth.google"];
  const urls = hosts.flatMap((h) => [`https://${h}.com/`, `https://a.${h}.com/`]);
  urls.push(
    "https://google.com/earth/",
    "https://www.google.com/earth/web",
    "https://AMAZON.com/",
    "https://www.amazon.de/",
  );
  expect(urls.filter((u) => !isPaintHost(u))).toStrictEqual([]);
  const other = [
    "https://google.com/maps",
    "https://www.google.com/",
    "https://notfigma.com/",
    "https://x.test/amazon",
  ];
  expect([...other, "", "not a url", undefined, null].filter((u) => isPaintHost(u))).toStrictEqual([]);
});

it("calls a page blocked when it asks for javascript, or is empty with no refs", () => {
  expect(isBlockedSnap(null, null)).toBe(true);
  expect(isBlockedSnap(undefined, "not a list")).toBe(true);
  expect(isBlockedSnap("x".repeat(100), [])).toBe(false);
  expect(isBlockedSnap("# https://x/\n\nshort", ["[1] link a"])).toBe(false);
  expect(isBlockedSnap("Just a moment...", ["[1] link a"])).toBe(true);
});

it("looks up lightpanda and the first chromium name on the given PATH", () => {
  const dir = tmp("bins-");
  function put(name: string) {
    fs.writeFileSync(path.join(dir, name), "#!/bin/sh\n", { mode: 0o755 });
    return path.join(dir, name);
  }
  expect(lookupBins(dir, "linux")).toStrictEqual({ chromium: "", lightpanda: "" });
  const second = put("chromium-browser");
  expect(lookupBins(dir, "linux").chromium).toBe(second);
  const [first, lp] = [put("chromium"), put("lightpanda")];
  expect(lookupBins(dir, "linux")).toStrictEqual({ chromium: first, lightpanda: lp });
  expect(lookupBins(undefined, "linux")).toStrictEqual(lookupBins(readEnv().PATH));
});

it("hints per platform, defaulting to this one", () => {
  expect(doctorHints("win32").join("\n")).toMatch(/winget/);
  expect(doctorHints("darwin").join("\n")).toMatch(/brew/);
  expect(doctorHints()).toStrictEqual(doctorHints(process.platform));
  expect(installHint("linux")).toMatch(
    /^no browser engine; install lightpanda \(https:\/\/github\.com\/lightpanda-io\/browser\) or Chromium\n/,
  );
  expect(installHint()).toBe(installHint(process.platform));
});

/** `pickEngine` on linux unless `o` says otherwise. */
function pickLinux(o: Parameters<typeof pickEngine>[0] = {}) {
  return pickEngine({ platform: "linux", ...o });
}

it("picks lightpanda, then chromium, and names the missing engine", () => {
  const both = { chromium: "/x/cr", lightpanda: "/x/lp" };
  expect(pickLinux({ bins: both })).toStrictEqual({ engine: "lightpanda" });
  expect(pickLinux({ bins: { lightpanda: "/x/lp" } })).toStrictEqual({
    engine: "lightpanda",
  });
  expect(pickLinux({ bins: { chromium: "/x/cr" } })).toStrictEqual({ engine: "chromium" });
  expect(pickLinux({ bins: both, forceChromium: true })).toStrictEqual({
    engine: "chromium",
  });
  expect(pickLinux({ bins: both, url: "https://figma.com/x" })).toStrictEqual({
    engine: "chromium",
  });
  expect(pickLinux().engine).toBeNull();
  expect(pickLinux().error).toMatch(/no browser engine/);
  expect(pickLinux({ bins: { lightpanda: "/x/lp" }, verb: "shot" }).engine).toBeNull();
  expect(pickLinux({ bins: { lightpanda: "/x/lp" }, platform: "win32" }).error).toMatch(/winget/);
});

it("lists the verbs for no verb, help, -h and --help, in any case", async () => {
  const help = {
    code: 0,
    stderr: "",
    stdout: "nav|snap|click|fill|scroll|wait|hover|select|shot|pdf|stop|doctor|ensure\n",
  };
  const argvs = [[], [""], ["help"], ["HELP"], ["-h"], ["--help"]];
  expect(await Promise.all(argvs.map((a) => runBrowser(a)))).toStrictEqual(argvs.map(() => help));
});

it("fails an unknown verb", async () => {
  expect(await exec(tmp("browser-unk-"), ["frobnicate"])).toStrictEqual(failure("unknown verb\n"));
});

it("keeps the session under the cwd's root, or the process cwd's when none is given", () => {
  const cwd = tmp("browser-dir-");
  expect(sessionDir(cwd)).toBe(path.join(fs.realpathSync(cwd), ".tmp/repo/browser"));
  expect(sessionDir()).toBe(sessionDir(process.cwd()));
});

it("keeps the session at the repo root's .tmp/repo/browser from packages/a", () => {
  const r = fs.realpathSync(tmp("browser-sub-"));
  spawnSync("git", ["init", "-q"], { cwd: r });
  const a = path.join(r, "packages", "a");
  fs.mkdirSync(a, { recursive: true });
  expect(sessionDir(a)).toBe(path.join(r, ".tmp/repo/browser"));
});
