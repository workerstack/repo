import fs from "node:fs";
import path from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  cleanBrowser,
  deadPid,
  exec,
  HOME_AND_SEARCH,
  live,
  methods,
  NEVER,
  NO_SESSION,
  nth,
  readStored,
  snapped,
  tmp,
  URL_X,
  writeFake,
} from "./__fixtures__/browser-kit.ts";

afterEach(cleanBrowser);

it("snap fails without a session or with a dead pid", async () => {
  const none = await exec(tmp("browser-snap-none-"), ["snap"]);
  expect(none.stderr).toBe(NO_SESSION);
  const t = await live({ pid: deadPid() });
  const dead = await exec(t.cwd, ["snap"]);
  expect(dead.stderr).toBe(NO_SESSION);
});

it("snap numbers the ref-bearing nodes in either ax shape, spells number and boolean names, keeps them", async () => {
  const axNodes = [
    { backendNodeId: 5, name: "Go", nodeId: "a", role: "button" },
    { backendDOMNodeId: 6, name: { value: "" }, role: { value: "LINK" } },
    { name: { value: "H" }, role: { value: "heading" } },
    {},
    { role: "textbox" },
    { name: {}, role: "link" },
    { role: {} },
    { name: { value: 3 }, role: "button" },
    { name: true, role: "link" },
  ];

  const t = await live({ lastRefs: {} }, { axNodes, markdown: "# T\n\nsome page body text" });
  const r = await exec(t.cwd, ["snap"]);
  const lines = "[1] button Go\n[2] link\n[3] textbox\n[4] link\n[5] button 3\n[6] link true\n";
  expect(r.stdout).toBe(`engine: lightpanda\nurl: ${URL_X}\n\n# T\n\nsome page body text\n\n${lines}`);
  expect(readStored(t.cwd).lastRefs).toStrictEqual({
    "1": { backendNodeId: 5, name: "Go", nodeId: "a", role: "button" },
    "2": { backendNodeId: 6, name: "", role: "link" },
    "3": { name: "", role: "textbox" },
    "4": { name: "", role: "link" },
    "5": { name: "3", role: "button" },
    "6": { name: "true", role: "link" },
  });
});

it("snap ends a ref-less page without doubling the newline", async () => {
  const body = "word ".repeat(30);
  const t = await live({}, { axNodes: [], markdown: `# ${URL_X}\n\n${body}` });
  const r = await exec(t.cwd, ["snap"]);
  expect(r.stdout).toBe(`engine: lightpanda\nurl: ${URL_X}\n\n# ${URL_X}\n\n${body.trim()}\n`);
});

it("snap falls back to a bare url heading when the markdown call fails or answers oddly", async () => {
  const replies = ["boom", {}, { markdown: 5 }, { markdown: "" }];

  const outs = await Promise.all(
    replies.map(async (reply) => {
      const t = await live({}, { replies: { "LP.getMarkdown": reply } });
      const r = await exec(t.cwd, ["snap"]);

      return r.stdout;
    }),
  );

  expect(outs).toStrictEqual(
    replies.map(() => `engine: lightpanda\nurl: ${URL_X}\n\n# ${URL_X}\n\n${HOME_AND_SEARCH}`),
  );
  const bare = await live({ lastURL: undefined }, { replies: { "LP.getMarkdown": "boom" } });
  const bareSnap = await exec(bare.cwd, ["snap"]);
  expect(bareSnap.stdout).toBe(`engine: lightpanda\nurl: \n\n#\n\n${HOME_AND_SEARCH}`);
});

it("snap takes the markdown from a result field when that is all the engine sends", async () => {
  const t = await live({}, { replies: { "LP.getMarkdown": { result: "# via result\n\ntext" } } });
  const r = await exec(t.cwd, ["snap"]);
  expect(r.stdout).toContain("# via result");
});

it("snap asks chromium for no markdown", async () => {
  const t = await live({ engine: "chromium" });
  const r = await exec(t.cwd, ["snap"]);
  expect(r.stdout).toBe(`engine: chromium\nurl: ${URL_X}\n\n# ${URL_X}\n\n${HOME_AND_SEARCH}`);
  expect(methods(t.calls)).not.toContain("LP.getMarkdown");
});

it("snap goes on when accessibility cannot be enabled, and reads no refs from a non-list", async () => {
  const replies = {
    "Accessibility.enable": "nope",
    "Accessibility.getFullAXTree": { nodes: "x" },
  };

  const t = await live({}, { markdown: `# T\n\n${"w ".repeat(60)}`, replies });
  const r = await exec(t.cwd, ["snap"]);
  expect(r.code).toBe(0);
  expect(readStored(t.cwd).lastRefs).toStrictEqual({});
});

it("snap stashes a long ref list and shows the headings and the first refs", async () => {
  const axNodes = Array.from({ length: 30 }, (_, i) => ({
    backendNodeId: i,
    name: `B${i + 1}`,
    role: "button",
  }));

  const t = await live({}, { axNodes, markdown: "# One\n\nbody\n\n## Two\n" });
  const r = await exec(t.cwd, ["snap"]);
  const lines = r.stdout.split("\n");
  expect(lines[0]).toBe("engine: lightpanda");
  expect(lines[2]).toMatch(/^26 shown\. stash=/);
  expect(lines.slice(3, 5)).toStrictEqual(["# One", "## Two"]);
  expect(lines).toContain("[24] button B24");
  expect(lines).not.toContain("[25] button B25");
  const dir = path.join(t.cwd, ".tmp/repo/stash");
  const file = nth(fs.readdirSync(dir), 0);
  expect(fs.readFileSync(path.join(dir, file), "utf8")).toContain("[30] button B30");
  expect(nth(lines, 2)).toContain(file);
});

it("snap stashes a page over 32 KiB even with few refs", async () => {
  const t = await live({}, { markdown: `# Big\n\n${"x".repeat(40_000)}` });
  const r = await exec(t.cwd, ["snap"]);
  expect(r.stdout).toMatch(/^engine: lightpanda\nurl: https:\/\/x\.test\/\n3 shown\. stash=/);
  expect(r.stdout.length).toBeLessThan(2000);
});

const BLOCKED = { axNodes: [], markdown: "Enable JavaScript to continue" };

it("snap keeps a blocked page on lightpanda with no chromium or a spent swap, or when it is chromium", async () => {
  const none = await snapped({}, BLOCKED);
  expect(none).toContain("engine: lightpanda");
  expect(none).toContain("Enable JavaScript");
  expect(await snapped({ swapCount: 1 }, BLOCKED, NEVER)).toContain("engine: lightpanda");
  expect(await snapped({ engine: "chromium" }, BLOCKED, NEVER)).toContain("engine: chromium");
});

it("snap keeps a fine page on lightpanda even when chromium exists", async () => {
  expect(await snapped({}, { markdown: `# ok\n\n${"fine ".repeat(30)}` }, NEVER)).toContain("engine: lightpanda");
});

it("snap swaps a blocked page to chromium without navigating when there is no url to replay", async () => {
  const t = await live({ lastURL: "" }, BLOCKED);
  const chromium = writeFake(t.bin, "chromium");
  const r = await exec(t.cwd, ["snap"], { bins: { chromium, lightpanda: "" } });
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/^engine: chromium\nurl: \n/);
  expect(readStored(t.cwd)).toMatchObject({
    engine: "chromium",
    escalated: true,
    lastURL: "",
    swapCount: 1,
  });
});
