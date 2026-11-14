/** Small type helpers the config types share. */
import type { Pack, SectionPacks } from "./config-schema.ts";

/** A list with at least one item. */
export type NonEmpty<T> = readonly [T, ...T[]];

/** Names a map cannot take: each one is refused as a key. */
export type Taken<N extends string> = { readonly [K in N]?: never };

/**
 * Section `K`'s shape `T` while `P` lists its pack. While the pack is off the section takes nothing, and the error
 * names the pack to add.
 */
export type Gated<P extends Pack, K extends keyof SectionPacks, T> = [SectionPacks[K]] extends [P]
  ? T
  : { [Key in `add "${SectionPacks[K]}" to packs to set this`]: never };
