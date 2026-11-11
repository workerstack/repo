import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initMcpJson } from "./init-mcp-json.ts";

const dirs: string[] = [];
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "init-mcp-json-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("initMcpJson", () => {
  it("writes an empty .mcp.json and says so", () => {
    const dest = tmp();
    const out: string[] = [];
    initMcpJson(dest, (s) => out.push(s));
    expect(fs.readFileSync(path.join(dest, ".mcp.json"), "utf8")).toBe(
      `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
    );
    expect(out).toStrictEqual(["repo init: wrote .mcp.json\n"]);
  });

  it("keeps a .mcp.json the repo has and prints nothing", () => {
    const dest = tmp();
    fs.writeFileSync(path.join(dest, ".mcp.json"), "mine\n");
    const out: string[] = [];
    initMcpJson(dest, (s) => out.push(s));
    expect(fs.readFileSync(path.join(dest, ".mcp.json"), "utf8")).toBe("mine\n");
    expect(out).toStrictEqual([]);
  });

  it("prints to the process's stdout when given no writer", () => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    initMcpJson(tmp());
    expect(write).toHaveBeenCalledWith("repo init: wrote .mcp.json\n");
  });
});
