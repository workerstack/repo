import type { Pack } from "../config.ts";

/** The texts of the supply-chain check. */

/** What a repo whose Cargo.lock git does not track is told. */
export const UNTRACKED_LOCK: string = "Cargo.lock is not tracked; commit it (cargo runs with --locked)";
/** The pack whose repos run the cargo supply-chain tools. */
export const TOOLS_PACK: Pack = "standards";
