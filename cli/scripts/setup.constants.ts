export const TARGETS: string[] = ["speak", "listen", "google-workspace", "browser", "jev"];

/** The targets every repo gets; the rest follow `agents.skills`. */
export const ALWAYS_ON: readonly string[] = ["browser", "jev"];

/** The names `setup` takes for google-workspace. */
export const GOOGLE_ALIASES: readonly string[] = ["gw", "google", "workspace", "google-workspace"];

/** The targets `repo setup` takes. */
export const SETUP_TARGETS = "[speak|listen|google-workspace|browser|jev]";

export const USAGE: string = `usage: setup ${SETUP_TARGETS}
  speak            --elevenlabs-key KEY | --openai-key KEY [--provider elevenlabs|openai] [--skip-verify]
  listen           [--openai-key KEY] [--device ID] [--skip-download]
  google-workspace [--creds PATH] [--account NAME] [--project ID]
  browser          (engine install hints; no secrets)
  jev              --api-key KEY
  --redo           redo a target that is already ok

TTY menu shows ok/missing. Missing bins: print OS command, then re-check PATH. Never installs.
Already ok: confirm redo (TTY) unless --redo. Ends with one status line per target (not a README).
Secrets: ~/.workerstack/ (not git). Env still wins over the file. Setup does not export keys.
`;

export const ELEVENLABS_KEY_URL = "https://elevenlabs.io/app/settings/api-keys";
export const OPENAI_KEY_URL = "https://platform.openai.com/api-keys";
export const JEV_KEY_URL = "https://console.typesafe.ai/keys";

/** The speak providers, and the menu answer that sets both keys. */
export const ELEVENLABS = "elevenlabs";
export const OPENAI = "openai";
export const BOTH = "both";

/** A flag's prefix, the value a bare `--flag` takes, and the values that turn a flag on. */
export const FLAG_PREFIX = "--";
export const FLAG_ON = "1";
export const FLAG_TRUE: readonly string[] = [FLAG_ON, "true"];

/** Secrets live in a dir only the user can enter, in files only the user can read. */
export const SECRET_DIR_MODE = 0o700;
export const SECRET_FILE_MODE = 0o600;
export const JSON_INDENT = 2;

/** The Desktop OAuth client file, under `~/.workerstack/workspace/<account>/` or as a download. */
export const OAUTH_FILE = "google-oauth.json";
