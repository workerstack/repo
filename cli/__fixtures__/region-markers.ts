import { type Region, regionHash, type RegionSyntax } from "../sync/region.ts";

/** `words` inside the line comment of `syntax`, in the exact form sync writes. */
export function markerLine(syntax: RegionSyntax, words: string): string {
  return syntax === "#" ? `# ${words}` : `<!-- ${words} -->`;
}

/** The open marker of region `name`, with `hash` when given. */
export function openMarker(syntax: RegionSyntax, name: string, hash?: string): string {
  return markerLine(syntax, hash === undefined ? `repo:${name}` : `repo:${name} ${hash}`);
}

/** The close marker of region `name`. */
export function closeMarker(syntax: RegionSyntax, name: string): string {
  return markerLine(syntax, `/repo:${name}`);
}

/** The region as sync writes it: the open line with the body's hash, the body, the close line. */
export function regionBlock(syntax: RegionSyntax, region: Region): string {
  return [openMarker(syntax, region.name, regionHash(region.body)), region.body, closeMarker(syntax, region.name)]
    .filter((line) => line !== "")
    .join("\n");
}
