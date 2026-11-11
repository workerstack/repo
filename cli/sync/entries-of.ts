import fs from "node:fs";

function byName(a: fs.Dirent, b: fs.Dirent): number {
  return Number(a.name > b.name) - Number(a.name < b.name);
}

/** The entries of the dir at `abs` sorted by name; none when it does not exist. */
export function entriesOf(abs: string): fs.Dirent[] {
  return fs.existsSync(abs) ? fs.readdirSync(abs, { withFileTypes: true }).toSorted(byName) : [];
}
