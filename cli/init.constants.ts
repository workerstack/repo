/** `--packs none` or an empty list: no skill packs. */
export const NO_PACKS: string = "none";

/** The postinstall init writes, so `bun install` generates the agent trees. */
export const SYNC_POSTINSTALL: string = "repo sync --postinstall";

/** A postinstall already holding this runs sync, so init leaves it alone. */
export const SYNC_COMMAND: string = "repo sync";

/** The indent init writes package.json with, before bun fmt lays it out. */
export const JSON_INDENT: number = 2;

/**
 * The `repo:*` scripts older inits copied into a consumer, with every value they wrote: init removes one still equal
 * to one of them.
 */
const OLD_DEFAULT_SCRIPTS = {
  "repo:antigravity": ["antigravity --dangerously-skip-permissions"],
  "repo:build": ["tsc -p tsconfig.build.json"],
  "repo:claude": ["claude --dangerously-skip-permissions"],
  "repo:clean": ["repo clean", "bun ./.rulesync/scripts/clean.ts", "node ./.rulesync/scripts/clean.mjs"],
  "repo:codex": ["codex --dangerously-bypass-approvals-and-sandbox"],
  "repo:doctor": [
    "repo doctor",
    "bun ./.rulesync/scripts/doctor.ts",
    "node ./.rulesync/scripts/doctor.mjs",
    "node ./scripts/doctor.mjs",
  ],
  "repo:gemini": ["gemini --yolo"],
  "repo:grok": ["grok --yolo"],
  "repo:hooks:check": [
    "bun .rulesync/scripts/hooks-union.ts --check",
    "node .rulesync/scripts/hooks-union.mjs --check",
    "node scripts/hooks-union.mjs --check",
  ],
  "repo:hooks:union": [
    "bun .rulesync/scripts/hooks-union.ts",
    "node .rulesync/scripts/hooks-union.mjs",
    "node scripts/hooks-union.mjs",
  ],
  "repo:prepack": ["bun run build"],
  "repo:purge:global-mcps": [
    "repo purge-mcps",
    "bun .rulesync/scripts/purge-global-mcps.ts",
    "node .rulesync/scripts/purge-global-mcps.mjs",
    "node scripts/purge-global-mcps.mjs",
  ],
  "repo:purge:global-mcps:apply": [
    "repo purge-mcps --apply",
    "bun .rulesync/scripts/purge-global-mcps.ts --apply",
    "node .rulesync/scripts/purge-global-mcps.mjs --apply",
    "node scripts/purge-global-mcps.mjs --apply",
  ],
  "repo:rulesync:check": [
    "bun ./.rulesync/scripts/guarded-roots.ts check",
    "node ./.rulesync/scripts/guarded-roots.mjs check",
    "node ./scripts/guarded-roots.mjs check",
    `rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,skills --check && rulesync generate -t \
codexcli,antigravity-cli,grokcli -f subagents --check && rulesync generate -t claudecode,codexcli,antigravity-cli -f \
hooks --check && node scripts/emit-mcp-policy.mjs --check && node scripts/emit-gemini.mjs --check && node \
scripts/emit-agent-shell-tools.mjs --check && node scripts/check-globals.mjs && node scripts/hooks-union.mjs --check`,
    `rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents --check && rulesync generate \
-t claudecode,codexcli,antigravity-cli -f hooks --check && node scripts/emit-mcp-policy.mjs --check && node \
scripts/check-globals.mjs`,
  ],
  "repo:rulesync:doctor": ["rulesync doctor"],
  "repo:rulesync:generate": [
    "bun ./.rulesync/scripts/guarded-roots.ts generate",
    "node ./.rulesync/scripts/guarded-roots.mjs generate",
    "node ./scripts/guarded-roots.mjs generate",
    `rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents,skills && rulesync generate \
-t claudecode,codexcli,antigravity-cli -f hooks && node scripts/emit-mcp-policy.mjs && node scripts/emit-gemini.mjs && \
node scripts/emit-agent-shell-tools.mjs && node scripts/hooks-union.mjs`,
    `rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents && rulesync generate -t \
claudecode,codexcli,antigravity-cli -f hooks && node scripts/emit-mcp-policy.mjs`,
  ],
  "repo:rulesync:watch": [
    "bun ./.rulesync/scripts/guarded-roots.ts watch",
    "node ./.rulesync/scripts/guarded-roots.mjs watch",
    "node ./scripts/guarded-roots.mjs watch",
    `node scripts/emit-mcp-policy.mjs && node scripts/emit-gemini.mjs && node scripts/emit-agent-shell-tools.mjs && \
rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f rules,subagents,skills --watch`,
    `node scripts/emit-mcp-policy.mjs && rulesync generate -t claudecode,codexcli,antigravity-cli,grokcli -f \
rules,subagents --watch`,
  ],
  "repo:setup": [
    "repo setup",
    "bun ./.rulesync/scripts/setup.ts",
    "node ./.rulesync/scripts/setup.mjs",
    "node ./scripts/setup.mjs",
  ],
  "repo:sync:globals": [
    "repo sync-globals",
    "bun .rulesync/scripts/sync-global-settings.ts",
    "node .rulesync/scripts/sync-global-settings.mjs",
    "node scripts/sync-global-settings.mjs",
  ],
  "repo:sync:globals:apply": [
    "repo sync-globals --apply",
    "bun .rulesync/scripts/sync-global-settings.ts --apply",
    "node .rulesync/scripts/sync-global-settings.mjs --apply",
    "node scripts/sync-global-settings.mjs --apply",
  ],
  "repo:sync:globals:check": [
    "bun .rulesync/scripts/check-globals.ts",
    "node .rulesync/scripts/check-globals.mjs",
    "node scripts/check-globals.mjs",
  ],
  "repo:tasks": ["repo tasks", "bun .rulesync/scripts/vscode-tasks.ts", "node .rulesync/scripts/vscode-tasks.mjs"],
  "repo:test:e2e": ["vitest run -c vitest.e2e.config.ts"],
  "repo:typecheck": ["tsc -p ."],
} satisfies Readonly<Record<string, readonly string[]>>;

function isOldDefault(name: string): name is keyof typeof OLD_DEFAULT_SCRIPTS {
  return Object.hasOwn(OLD_DEFAULT_SCRIPTS, name);
}

/** Whether an older init wrote the script `name` with `value`, so init may remove it. */
export function isOldDefaultScript(name: string, value: string): boolean {
  return isOldDefault(name) && OLD_DEFAULT_SCRIPTS[name].includes(value);
}
