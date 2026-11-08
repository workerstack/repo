/** Optional installer packs. The package still ships them. Init writes only the selected ones. */
import fs from "node:fs";
import path from "node:path";
import { isRecord } from "./hook-input.ts";
import { SKILLS_SOURCE_REL } from "./skill-conflicts.ts";

export const FEATURES_REL = ".rulesync/repo.features.jsonc";

/** A pack's skill folder, reference doc and script; an empty `script` means it ships none. */
export interface OptionalPack {
  name: string;
  skill: string;
  ref: string;
  script: string;
}

/** The packs a caller picked, as a list or a set. */
export type PackSelection = Set<string> | readonly string[] | null | undefined;

export const OPTIONAL_PACKS: OptionalPack[] = [
  { name: "google-workspace", skill: "google-workspace", ref: "google-workspace.md", script: "google-workspace.ts" },
  { name: "listen", skill: "listen", ref: "listen.md", script: "listen.ts" },
  { name: "speak", skill: "speak", ref: "speak.md", script: "speak.ts" },
  { name: "clasp", skill: "clasp", ref: "clasp.md", script: "" },
];

export const PACK_OPTIONS = OPTIONAL_PACKS.map((pack) => ({ value: pack.name, label: pack.name }));

function partsOf(rel: string | null | undefined): string[] {
  return String(rel || "").split(/[/\\]/).filter((part) => part && part !== ".");
}

function knownSet() {
  return new Set(OPTIONAL_PACKS.map((pack) => pack.name));
}

function inTableOrder(names: Iterable<string>): string[] {
  const on = new Set(names);
  return OPTIONAL_PACKS.map((pack) => pack.name).filter((name) => on.has(name));
}

export function normalizePacks(list: readonly unknown[] | null | undefined): string[] {
  const known = knownSet();
  const seen: string[] = [];
  for (const raw of list || []) {
    const name = String(raw || "").trim();
    if (!name || seen.includes(name)) continue;
    if (!known.has(name)) throw new Error(`unknown pack ${name}`);
    seen.push(name);
  }
  return inTableOrder(seen);
}

export function parsePacksFlag(value: unknown): string[] {
  const text = String(value ?? "").trim();
  if (!text || text === "none") return [];
  return normalizePacks(text.split(","));
}

function stripJsonc(text: string): string {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** null when the file is missing. Bad JSON or an empty list is `{ packs: [] }`. */
export function readPacks(dest: string): { packs: string[] } | null {
  const abs = path.join(dest, FEATURES_REL);
  if (!fs.existsSync(abs)) return null;
  try {
    const data: unknown = JSON.parse(stripJsonc(fs.readFileSync(abs, "utf8")));
    const raw: unknown[] = isRecord(data) && Array.isArray(data.packs) ? data.packs : [];
    const known = knownSet();
    return { packs: inTableOrder(raw.map((name) => String(name).trim()).filter((name) => known.has(name))) };
  } catch {
    return { packs: [] };
  }
}

export function selectedPacks(dest: string): string[] {
  const saved = readPacks(dest);
  return saved ? saved.packs : [];
}

export function writePacks(dest: string, packs: readonly unknown[] | null | undefined): void {
  const selected = normalizePacks(packs);
  const abs = path.join(dest, FEATURES_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify({ packs: selected }, null, 2)}\n`);
}

/** An array, including `[]`, is an answer. Otherwise use the saved file, or nothing. */
export function resolvePackSelection(dest: string, packs: unknown): { packs: string[]; answered: boolean } {
  if (Array.isArray(packs)) return { packs: normalizePacks(packs), answered: true };
  const saved = readPacks(dest);
  if (saved) return { packs: saved.packs, answered: false };
  return { packs: [], answered: false };
}

export function isUnselectedPackPath(rel: string | null | undefined, selected: PackSelection): boolean {
  const on = selected instanceof Set ? selected : new Set<string>(selected || []);
  const parts = partsOf(rel);
  if (parts.length >= 3 && parts.slice(0, 2).join("/") === SKILLS_SOURCE_REL) {
    const pack = OPTIONAL_PACKS.find((item) => item.skill === parts[2]);
    if (pack && !on.has(pack.name)) return true;
  }
  if (parts[0] === ".rulesync" && parts[1] === "reference" && parts.length >= 3) {
    const pack = OPTIONAL_PACKS.find((item) => item.ref === parts[2]);
    if (pack && !on.has(pack.name)) return true;
  }
  return false;
}

export function unselectedPackRels(selected: PackSelection): string[] {
  const on = selected instanceof Set ? selected : new Set<string>(selected || []);
  const rels: string[] = [];
  for (const pack of OPTIONAL_PACKS) {
    if (on.has(pack.name)) continue;
    rels.push(`${SKILLS_SOURCE_REL}/${pack.skill}`);
    if (pack.ref) rels.push(`.rulesync/reference/${pack.ref}`);
    if (pack.script) rels.push(`.rulesync/scripts/${pack.script}`);
  }
  return rels;
}

export function unselectedRefNames(selected: PackSelection): Set<string> {
  const on = selected instanceof Set ? selected : new Set<string>(selected || []);
  return new Set(OPTIONAL_PACKS.filter((pack) => pack.ref && !on.has(pack.name)).map((pack) => pack.ref));
}

export function unselectedScriptNames(selected: PackSelection): Set<string> {
  const on = selected instanceof Set ? selected : new Set<string>(selected || []);
  return new Set(OPTIONAL_PACKS.filter((pack) => pack.script && !on.has(pack.name)).map((pack) => pack.script));
}
