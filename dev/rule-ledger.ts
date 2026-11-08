#!/usr/bin/env bun
/** Check that every rule line of the given docs maps to a slice, a decision, or a landed roadmap in a ledger. */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export type LedgerIo = { log: (line: string) => void };

const USAGE = "usage: bun dev/rule-ledger.ts <ledger.json> <doc.md>...";
const RULE_LINE = /^- \[[ x]\]/;
const HEADING = /^#{1,6}\s+(.*?)\s*#*\s*$/;

const targetSchema = z.union([
  z.strictObject({ slice: z.number() }),
  z.strictObject({ decision: z.string() }),
  z.strictObject({ landed: z.string() }),
]);
const ledgerSchema = z.strictObject({
  sections: z.record(z.string(), targetSchema),
  lines: z.record(z.string(), targetSchema),
});

type Target = z.infer<typeof targetSchema>;
type RuleLine = { lineno: number; text: string; section: string | null };

/** The rule lines of a doc, each with its nearest preceding heading, and the headings that hold at least one. */
function ruleLines(text: string): RuleLine[] {
  const found: RuleLine[] = [];
  let section: string | null = null;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    if (heading !== null) section = heading[1]!;
    else if (RULE_LINE.test(line)) found.push({ lineno: index + 1, text: line, section });
  });
  return found;
}

/** Runs the ledger check; prints each problem or the summary through `io` and returns the exit code. */
export function runLedger(args: string[], io: LedgerIo): number {
  const [ledgerPath, ...docs] = args;
  if (ledgerPath === undefined || docs.length === 0) {
    io.log(USAGE);
    return 1;
  }
  let ledger: z.infer<typeof ledgerSchema>;
  try {
    ledger = ledgerSchema.parse(JSON.parse(fs.readFileSync(ledgerPath, "utf8")));
  } catch (error) {
    io.log(`${ledgerPath}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  let problems = 0;
  let mapped = 0;
  const counts = { slice: 0, decision: 0, landed: 0 };
  const usedSections = new Set<string>();
  const usedLines = new Set<string>();
  for (const doc of docs) {
    const name = path.basename(doc);
    for (const rule of ruleLines(fs.readFileSync(doc, "utf8"))) {
      const sectionKey = rule.section === null ? null : `${name}#${rule.section}`;
      if (sectionKey !== null) usedSections.add(sectionKey);
      const lineKey = `${name}#${rule.text}`;
      let target: Target | undefined = ledger.lines[lineKey];
      if (target !== undefined) usedLines.add(lineKey);
      else target = sectionKey === null ? undefined : ledger.sections[sectionKey];
      if (target === undefined) {
        io.log(`${doc}:${rule.lineno}: unmapped: "${rule.text}"; add it to the ledger`);
        problems++;
        continue;
      }
      mapped++;
      counts["slice" in target ? "slice" : "decision" in target ? "decision" : "landed"]++;
    }
  }
  for (const key of Object.keys(ledger.lines)) {
    if (usedLines.has(key)) continue;
    io.log(`stale line key: ${key}`);
    problems++;
  }
  for (const key of Object.keys(ledger.sections)) {
    if (usedSections.has(key)) continue;
    io.log(`stale section key: ${key}`);
    problems++;
  }
  if (problems > 0) return 1;
  io.log(
    `rule ledger: ${mapped} lines mapped (${counts.slice} to slices, ${counts.decision} to decisions, ${counts.landed} landed); 0 unmapped; 0 stale`,
  );
  return 0;
}

if (import.meta.main) process.exit(runLedger(process.argv.slice(2), { log: (line) => console.log(line) }));
