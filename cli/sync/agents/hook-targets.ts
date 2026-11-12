/** The matcher-group hosts' converter configs: claude, codex and antigravity. `D:<n>` cites rulesync 43.7.0. */
import {
  AGENT,
  ANTIGRAVITY_EVENTS,
  ANTIGRAVITY_KEY,
  ANTIGRAVITY_NO_MATCHER,
  ANTIGRAVITY_TOOLS,
  CLAUDE_EVENTS,
  CLAUDE_KEY,
  CLAUDE_NO_MATCHER,
  CODEX_EVENTS,
  CODEX_KEY,
  COMMAND,
  HTTP,
  LEADING_DOT_SLASH,
  LEADING_QUOTE,
  MATCHER_TOKEN,
  MCP_TOOL,
  PROMPT,
  WRAPPED_IN_QUOTES,
} from "./hooks.constants.ts";
import type { Def, Target } from "./hooks.types.ts";

/**
 * Deliberate divergence from rulesync: only a leading `./` (optionally quoted) gets the project dir; script
 * operands later in the command are left alone. A shell command gets `"$CLAUDE_PROJECT_DIR"/`; an exec-form
 * hook (`args` is an array) gets `${CLAUDE_PROJECT_DIR}/` with the surrounding quotes stripped (D:53245-53266).
 */
function prefixProjectDir(command: string, def: Def): string {
  const lead = LEADING_DOT_SLASH.exec(command);

  if (lead?.groups === undefined) return command;

  const { quote, rest } = lead.groups /* both named groups always take part in a match */ as {
    quote: string;
    rest: string;
  };

  const relative = `${quote}${rest}`;

  if (!Array.isArray(def["args"])) return `"$CLAUDE_PROJECT_DIR"/${relative}`;

  return `\${CLAUDE_PROJECT_DIR}/${relative.replace(WRAPPED_IN_QUOTES, "$<inner>").replace(LEADING_QUOTE, "")}`;
}

/** A matcher with each whole tool name antigravity names differently replaced. */
function antigravityMatcher(matcher: string): string {
  return matcher.replaceAll(MATCHER_TOKEN, (token) =>
    Object.hasOwn(ANTIGRAVITY_TOOLS, token) ? (ANTIGRAVITY_TOOLS[token] /* hasOwn proved the key */ as string) : token,
  );
}

export const CLAUDE: Readonly<Target> = {
  command: prefixProjectDir,
  named: false,
  names: CLAUDE_EVENTS,
  noMatcher: CLAUDE_NO_MATCHER,
  overrideKey: CLAUDE_KEY,
  // D:55633-55684, in emit order: booleans, keyword, strings, arrays.
  passthrough: [
    { key: "once", kind: "boolean" },
    { commandOnly: true, key: "async", kind: "boolean" },
    { commandOnly: true, key: "asyncRewake", kind: "boolean" },
    { key: "continueOnBlock", kind: "boolean" },
    { key: "onFailure", kind: "keyword" },
    { key: "if", kind: "string" },
    { key: "statusMessage", kind: "string" },
    { commandOnly: true, key: "shell", kind: "string" },
    { commandOnly: true, key: "args", kind: "array" },
  ],
  promptModel: true,
  types: /* @__PURE__ */ new Set([COMMAND, PROMPT, HTTP, MCP_TOOL, AGENT]),
};

export const CODEX: Readonly<Target> = {
  named: true,
  names: CODEX_EVENTS,
  noMatcher: /* @__PURE__ */ new Set(),
  overrideKey: CODEX_KEY,
  // D:56377-56394, in emit order: booleans, numbers, strings.
  passthrough: [
    { commandOnly: true, key: "async", kind: "boolean" },
    { commandOnly: true, key: "additionalContextLimit", kind: "number" },
    { commandOnly: true, key: "commandWindows", kind: "string" },
    { key: "statusMessage", kind: "string" },
  ],
  promptModel: false,
  types: /* @__PURE__ */ new Set([COMMAND, MCP_TOOL]),
};

export const ANTIGRAVITY: Readonly<Target> = {
  matcher: antigravityMatcher,
  named: false,
  names: ANTIGRAVITY_EVENTS,
  noMatcher: ANTIGRAVITY_NO_MATCHER,
  overrideKey: ANTIGRAVITY_KEY,
  passthrough: [],
  promptModel: false,
  types: /* @__PURE__ */ new Set([COMMAND]),
};
