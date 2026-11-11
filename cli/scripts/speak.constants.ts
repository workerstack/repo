/** The providers, defaults, endpoints and messages of `repo speak`. */

/** The two text-to-speech providers. */
export const ELEVENLABS = "elevenlabs";
export const OPENAI = "openai";

export const DEFAULT_ELEVEN_VOICE = "JBFqnCBsd6RMkjVDRZzb";
export const DEFAULT_ELEVEN_MODEL = "eleven_multilingual_v2";
export const DEFAULT_OPENAI_VOICE = "coral";
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini-tts";
export const OPENAI_VOICES: readonly string[] = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
];

export const ELEVEN_API = "https://api.elevenlabs.io/v1";
export const OPENAI_API = "https://api.openai.com/v1";
/** The audio format ElevenLabs is asked for. */
export const ELEVEN_FORMAT = "mp3_44100_128";

/** The verbs `repo speak` runs. */
export const VERB_WHOAMI = "whoami";
export const VERB_VOICES = "voices";
export const VERB_SAY = "say";
export const FLAG_TRUE = "true";

/** HTTP statuses that mean the key is missing or rejected, and how much of an error body to keep. */
export const UNAUTHORIZED = 401;
export const FORBIDDEN = 403;
export const HTTP_BODY_CHARS = 200;

export const USAGE =
  "usage: speak whoami | voices | say --text T [--provider elevenlabs|openai] [--voice ID] [--out path] [--play]";
export const SETUP = "bun repo setup speak";
export const SPEAK_DIR = ".tmp/repo/speak";
export const NEED_KEY =
  "missing ELEVENLABS_API_KEY or OPENAI_API_KEY (or ~/.workerstack/speak.json). setup: bun repo setup speak";
export const NEED_ELEVEN =
  "missing ELEVENLABS_API_KEY (or ~/.workerstack/speak.json elevenlabs.apiKey). setup: bun repo setup speak";
export const NEED_OPENAI =
  "missing OPENAI_API_KEY (or ~/.workerstack/speak.json openai.apiKey). setup: bun repo setup speak";
