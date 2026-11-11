import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HOOK_COMMANDS_KEY,
  STOCK_HISTORY_FILE,
  STOCK_PREFIXES,
  hashText,
  hookCommands,
  readStockHistory,
} from "./stock-history.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("hashText", () => {
  it("is 16 hex digits and reads CRLF text as LF", () => {
    expect(hashText("a\nb\n")).toMatch(/^[0-9a-f]{16}$/);
    expect(hashText("a\r\nb\r\n")).toBe(hashText("a\nb\n"));
    expect(hashText(Buffer.from("a\nb\n"))).toBe(hashText("a\nb\n"));
    expect(hashText("a\nb")).not.toBe(hashText("a\nb\n"));
  });
});

describe("readStockHistory", () => {
  it("reads a table from a file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workerstack-history-"));
    temps.push(dir);
    fs.writeFileSync(path.join(dir, "h.json"), '{ "a.md": ["0123456789abcdef"] }');
    expect(readStockHistory(path.join(dir, "h.json"))).toStrictEqual({ "a.md": ["0123456789abcdef"] });
  });

  it("ships a sorted table of 16-hex hashes under stock paths", () => {
    const table = readStockHistory();
    expect(STOCK_HISTORY_FILE.split(path.sep).join("/").endsWith("cli/sync/stock-history.json")).toBe(true);
    const paths = Object.keys(table);
    expect(paths.length).toBeGreaterThan(50);
    expect(paths).toStrictEqual([...paths].sort());
    for (const [rel, hashes] of Object.entries(table)) {
      if (rel === HOOK_COMMANDS_KEY) continue;
      expect(STOCK_PREFIXES.some((prefix) => rel === prefix || (prefix.endsWith("/") && rel.startsWith(prefix)))).toBe(
        true,
      );
      expect(hashes).toStrictEqual([...hashes].sort());
      for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

describe("hookCommands", () => {
  it("lists every command under hooks, whatever the nesting, and nothing else", () => {
    const settings = {
      env: { command: "not a hook" },
      hooks: {
        A: [{ matcher: "x", hooks: [{ type: "command", command: "one" }, { type: "prompt", command: 5 }, "text"] }],
        B: [{ hooks: [{ command: "two" }] }],
      },
    };
    expect(hookCommands(settings)).toStrictEqual(["one", "two"]);
    expect(hookCommands(null)).toStrictEqual([]);
    expect(hookCommands({})).toStrictEqual([]);
  });
});
