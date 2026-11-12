export const MODEL = "jev-1.13.0";
export const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const MAX_STATE_CHARS = 64_000;
export const MAX_QUESTIONS = 8;
export const MAX_REQUESTS_PER_DAY = 40;
export const MAX_INPUT_TOKENS_PER_DAY = 1_000_000;
export const TIMEOUT_MS = 10_000;
export const MAX_RETRY_WAIT_MS = 2_000;
export const LOCK_STALE_MS = 10_000;

/** What `repo jev` takes. */
export const JEV_ARGS = "--available | --state FILE --questions FILE";
export const USAGE: string = `usage: bun repo jev ${JEV_ARGS}\n`;
export const MISSING_KEY = "missing TYPESAFE_API_KEY or ~/.workerstack/jev.json. setup: bun repo setup jev\n";
export const REQUEST_FAILED = "jev request failed\n";
export const NOT_AN_OBJECT = "questions must be a JSON object\n";

/** The exit code and result code of every refusal. */
export const FAIL_CODE = 2;

/** A rough count of characters per input token, for the estimate the ledger reserves. */
export const CHARS_PER_TOKEN = 4;
export const MS_PER_SECOND = 1000;

/** The statuses a retry-after wait may follow: rate limited, overloaded. */
export const RETRY_STATUSES: readonly number[] = [429, 529];
export const HTTP_OK_MIN = 200;
export const HTTP_OK_END = 300;

/** The model line plus at most seven answers. */
export const MAX_ANSWER_LINES = 8;

/** The answer kinds the summary prints. */
export const CHOICE = "choice";
export const NOUL = "noul";
export const SCORE = "score";

/** The ledger and its lock: only the user may read the file or enter the dir. */
export const SECRET_FILE_MODE = 0o600;
export const SECRET_DIR_MODE = 0o700;

/** `YYYY-MM-DD`, the ledger's day, from an ISO timestamp. */
export const DAY_CHARS = 10;

/** How long to sleep between lock attempts, and the 4-byte buffer `Atomics.wait` sleeps on. */
export const LOCK_POLL_MS = 20;
export const INT32_BYTES = 4;
export const EEXIST = "EEXIST";

/** The value a bare `--flag` takes, and the prefix every flag starts with. */
export const FLAG_ON = "1";
export const FLAG_PREFIX = "--";
