/** How many times `removeTree` calls rm before it gives up. */
export const REMOVE_ATTEMPTS = 10;

/** The wait after the first failed try; each later wait adds this again (100, 200, ... ms). */
export const REMOVE_DELAY_MS = 100;

/**
 * The codes Windows gives while another process, a virus scanner or a child that is still exiting, holds a file in
 * the tree for a moment. Node's `rmSync` retries these; Bun parses `maxRetries` but never retries.
 */
export const BUSY_CODES: readonly string[] = ["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"];

/** The code rm throws for an entry that vanished mid-walk; retried only while the target is still there. */
export const GONE_CODE = "ENOENT";

/** The code of the error thrown when rm returns but leaves the target behind. */
export const LEFT_CODE = "ENOTEMPTY";
