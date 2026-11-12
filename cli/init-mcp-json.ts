/** Init's `.mcp.json`: the user's own MCP file, tracked, that every other host's MCP file is built from. */
import fs from "node:fs";
import path from "node:path";

const MCP_JSON = ".mcp.json";
const EMPTY_MCP_JSON = '{\n  "mcpServers": {}\n}\n';

/**
 * Writes an empty `.mcp.json` into `dest` only when it has none, and then prints one line saying so to `stdout` (the
 * process's stdout when omitted). A `.mcp.json` the repo already has is kept and goes unmentioned.
 */
export function initMcpJson(dest: string, stdout: (s: string) => void = (s) => process.stdout.write(s)): void {
  const file = path.join(dest, MCP_JSON);

  if (fs.existsSync(file)) return;
  fs.writeFileSync(file, EMPTY_MCP_JSON);
  stdout(`repo init: wrote ${MCP_JSON}\n`);
}
