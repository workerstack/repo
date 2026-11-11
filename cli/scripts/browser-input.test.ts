import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  callParams,
  cleanBrowser,
  exec,
  failure,
  live,
  methods,
  NEVER,
  NO_SESSION,
  nth,
  readStored,
  run,
  sessionPath,
  tmp,
  URL_X,
  writeFake,
} from "./__fixtures__/browser-kit.ts";
import { navigated } from "./__fixtures__/browser-nav-kit.ts";

afterEach(cleanBrowser);

it("click <ref> / fill <ref> <text> against last snap refs", async () => {
  const { bin, cwd } = await navigated("browser-click-", ["lightpanda"]);
  const snap = await run(cwd, ["snap"], bin);
  expect(snap.code).toBe(0);
  const click = await run(cwd, ["click", "1"], bin);
  expect(click.code).toBe(0);
  const fill = await run(cwd, ["fill", "2", "hello"], bin);
  expect(fill.code).toBe(0);
  const hover = await run(cwd, ["hover", "1"], bin);
  expect(hover.code).toBe(0);
  expect(hover.stdout).toMatch(/hover: 1/);
  const sel = await run(cwd, ["select", "2", "opt"], bin);
  expect(sel.code).toBe(0);
  const scrolled = await run(cwd, ["scroll", "down"], bin);
  expect(scrolled.code).toBe(0);
  const waited = await run(cwd, ["wait", "0"], bin);
  expect(waited.code).toBe(0);
  expect(waited.stdout).toMatch(/wait: 0/);
});

it("missing/stale ref fails clearly", async () => {
  const { bin, cwd } = await navigated("browser-stale-", ["lightpanda"]);
  const snap = await run(cwd, ["snap"], bin);
  expect(snap.code).toBe(0);
  const missing = await run(cwd, ["click", "99"], bin);
  expect(missing.code).not.toBe(0);
  expect(missing.stderr).toMatch(/ref|stale|missing/i);
  const s = readStored(cwd);
  s.lastRefs["1"] = { backendNodeId: 99999, name: "Home", role: "link" };
  fs.writeFileSync(sessionPath(cwd), JSON.stringify(s));
  const stale = await run(cwd, ["click", "1"], bin);
  expect(stale.code).not.toBe(0);
  expect(stale.stderr).toMatch(/stale|missing/i);
});

it("click/fill with no session / no prior snap fails; no implicit Chromium", async () => {
  const cwd = tmp("browser-nosess-");
  const bin = path.join(cwd, "bin");
  writeFake(bin, "chromium");
  const click = await run(cwd, ["click", "1"], bin);
  expect(click.code).not.toBe(0);
  expect(click.stderr).toMatch(/session|snap|nav/i);
  expect(fs.existsSync(sessionPath(cwd))).toBe(false);
  writeFake(bin, "lightpanda");
  const nav = await run(cwd, ["nav", "https://example.com/"], bin);
  expect(nav.code).toBe(0);
  const fill = await run(cwd, ["fill", "1", "x"], bin);
  expect(fill.code).not.toBe(0);
  expect(fill.stderr).toMatch(/snap|ref/i);
  expect(readStored(cwd).engine).toBe("lightpanda");
});

it("click needs a session, then refs, then a known ref", async () => {
  const noSession = await exec(tmp("browser-act-none-"), ["click", "1"]);
  expect(noSession.stderr).toBe(NO_SESSION);
  const norefs = await live({ lastRefs: {} });
  const noRefs = await exec(norefs.cwd, ["click", "1"]);
  expect(noRefs.stderr).toBe("no snap refs; run snap\n");
  const t = await live();
  const unknown = await exec(t.cwd, ["click", "7"]);
  expect(unknown.stderr).toBe("missing ref: 7\n");
  const none = await exec(t.cwd, ["click"]);
  expect(none.stderr).toBe("missing ref: \n");
  expect(t.calls).toStrictEqual([]);
});

it("fill needs text and select needs a value", async () => {
  const t = await live();
  const fill = await exec(t.cwd, ["fill", "2"]);
  expect(fill.stderr).toBe("fill <ref> <text>\n");
  const select = await exec(t.cwd, ["select", "2"]);
  expect(select.stderr).toBe("select <ref> <value>\n");
  expect(t.calls).toStrictEqual([]);
});

it("click and hover act on the resolved node", async () => {
  const t = await live();
  const click = await exec(t.cwd, ["click", "1"]);
  expect(click.stdout).toBe("click: 1\n");
  const hover = await exec(t.cwd, ["hover", "2"]);
  expect(hover.stdout).toBe("hover: 2\n");
  const resolve = ["DOM.resolveNode", "Runtime.callFunctionOn"];
  expect(methods(t.calls)).toStrictEqual([...resolve, ...resolve]);
  expect(nth(callParams(t.calls), 0)).toStrictEqual({
    functionDeclaration: "function() { this.click(); }",
    objectId: "oid-10",
  });
  expect(nth(callParams(t.calls), 1)).toMatchObject({ objectId: "oid-11" });
  expect(String(nth(callParams(t.calls), 1).functionDeclaration)).toContain("mouseover");
});

it("fill focuses, clears, inserts the joined words, then fires input", async () => {
  const t = await live();
  const r = await exec(t.cwd, ["fill", "2", "hello", "big", "world"]);
  expect(r.stdout).toBe("fill: 2\n");
  expect(methods(t.calls)).toStrictEqual([
    "DOM.resolveNode",
    "Runtime.callFunctionOn",
    "Input.insertText",
    "Runtime.callFunctionOn",
  ]);
  expect(nth(t.calls, 2).params).toStrictEqual({ text: "hello big world" });
  expect(String(nth(callParams(t.calls), 0).functionDeclaration)).toContain("this.focus()");
  expect(String(nth(callParams(t.calls), 1).functionDeclaration)).toContain("'input'");
});

it("select sets the value and fires change", async () => {
  const t = await live();
  const select = await exec(t.cwd, ["select", "2", "opt", "a"]);
  expect(select.stdout).toBe("select: 2\n");
  const call = nth(callParams(t.calls), 0);
  expect(call).toMatchObject({
    arguments: [{ value: "opt a" }],
    objectId: "oid-11",
  });
  expect(String(call.functionDeclaration)).toContain("'change'");
});

it("click calls a ref stale when it does not resolve to an object", async () => {
  const gone = await live({ lastRefs: { "1": { backendNodeId: 99 } } });
  const goneRef = await exec(gone.cwd, ["click", "1"]);
  expect(goneRef.stderr).toBe("stale ref: 1\n");
  const noObject = await live({}, { replies: { "DOM.resolveNode": {} } });
  const noObjectRef = await exec(noObject.cwd, ["click", "1"]);
  expect(noObjectRef.stderr).toBe("stale ref: 1\n");
});

it("click reports another engine error as it is on chromium, with no chromium, or after a spent swap", async () => {
  const replies = { "Runtime.callFunctionOn": "boom" };
  const chrome = await live({ engine: "chromium" }, { replies });
  expect(await exec(chrome.cwd, ["click", "1"], { bins: NEVER })).toStrictEqual(failure("boom\n"));
  const noBin = await live({}, { replies });
  const noBinClick = await exec(noBin.cwd, ["click", "1"]);
  expect(noBinClick.stderr).toBe("boom\n");
  const spent = await live({ swapCount: 1 }, { replies });
  const spentClick = await exec(spent.cwd, ["click", "1"], { bins: NEVER });
  expect(spentClick.stderr).toBe("boom\n");
  expect(readStored(spent.cwd).engine).toBe("lightpanda");
});

it("click replays once on chromium when lightpanda fails the action", async () => {
  const t = await live({}, { replies: { "Runtime.callFunctionOn": "boom" } });
  const chromium = writeFake(t.bin, "chromium");
  const r = await exec(t.cwd, ["click", "1"], {
    bins: { chromium, lightpanda: "" },
  });
  expect(r).toStrictEqual({ code: 0, stderr: "", stdout: "click: 1\n" });
  const s = readStored(t.cwd);
  expect(s).toMatchObject({
    engine: "chromium",
    escalated: true,
    lastURL: URL_X,
    swapCount: 1,
  });
  expect(Object.keys(s.lastRefs)).toStrictEqual(["1", "2"]);
});

it("click reports a stale ref, or the engine's own error, when the chromium replay fails too", async () => {
  const first = { "Runtime.callFunctionOn": "boom" };
  const stale = await live({}, { replies: first });
  const staleBin = writeFake(stale.bin, "chromium", {
    state: { replies: { "DOM.resolveNode": "node is stale" } },
  });
  const a = await exec(stale.cwd, ["click", "1"], {
    bins: { chromium: staleBin, lightpanda: "" },
  });
  expect(a).toStrictEqual(failure("stale ref: 1\n"));
  const other = await live({}, { replies: first });
  const otherBin = writeFake(other.bin, "chromium", {
    state: { replies: { "Runtime.callFunctionOn": "boom two" } },
  });
  const b = await exec(other.cwd, ["click", "1"], {
    bins: { chromium: otherBin, lightpanda: "" },
  });
  expect(b).toStrictEqual(failure("boom two\n"));
});
