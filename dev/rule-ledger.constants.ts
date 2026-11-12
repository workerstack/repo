export const USAGE = "usage: bun dev/rule-ledger.ts <ledger.json> <doc.md>...";
export const RULE_LINE: RegExp = /^- \[[ x]\]/;
export const HEADING: RegExp = /^#{1,6}\s+(.*?)\s*#*\s*$/;

/** The arguments after the runtime and the script path. */
export const ARGV_START = 2;
