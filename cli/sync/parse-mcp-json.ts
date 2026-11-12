/**
 * The one reader of the user's `.mcp.json`, which sync never writes: the MCP files of the other hosts are built from
 * its `mcpServers`. It is user input, so it is checked here, at the boundary, and nowhere after.
 */
import { parse, type ParseError } from "jsonc-parser";

import { isRecord, type JsonObject } from "../json.ts";

const MCP_JSON = ".mcp.json";
const SERVERS_KEY = "mcpServers";
const FIX = "fix it, nothing written";

/** Plain JSON: what `claude mcp add --scope project` writes and every host parses. */
const STRICT = { allowEmptyContent: false, allowTrailingComma: false, disallowComments: true };

function failed(problem: string) {
  return { error: `${MCP_JSON}: ${problem}; ${FIX}`, ok: false as const };
}

/**
 * The servers of `.mcp.json` given its text, none when it is missing (`null`); a named error when it is no JSON object
 * or its `mcpServers` is no object.
 */
export function parseMcpJson(text: string | null): { ok: true; servers: JsonObject } | { ok: false; error: string } {
  if (text === null) return { ok: true, servers: {} };
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, STRICT);
  const [first] = errors;

  if (first !== undefined) return failed(`not valid JSON at line ${text.slice(0, first.offset).split("\n").length}`);

  if (!isRecord(value)) return failed("not a JSON object");
  const servers = Object.hasOwn(value, SERVERS_KEY) ? value[SERVERS_KEY] : {};

  return isRecord(servers) ? { ok: true, servers } : failed(`${SERVERS_KEY} is not an object`);
}
