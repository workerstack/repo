import type { AudioDevice } from "./listen.types.ts";

/** The OpenAI model, the local ggml model and the whisper.cpp binaries `repo listen` looks for. */
export const DEFAULT_MODEL = "whisper-1";
export const DEFAULT_GGML = "ggml-base.en.bin";
export const WHISPER_BINS: readonly string[] = ["whisper-cli", "whisper-cpp"];
export const GGML_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
export const TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
export const USER_AGENT = "repo-listen";
/** The private mode of the dir the ggml model downloads into. */
export const GGML_DIR_MODE = 0o700;

/** Recording length: the default, the cap, and the grace past it before a capture is killed. */
export const DEFAULT_SECONDS = 8;
export const MAX_SECONDS = 120;
export const KILL_GRACE_SECONDS = 2;
export const MS_PER_SECOND = 1000;

/** How long `stop` waits for the recorder to exit, and how often it looks. */
export const STOP_WAIT_MS = 8000;
export const STOP_POLL_MS = 50;
export const SLEEP_CELL_BYTES = 4;

/** ffmpeg's exit when `q` stops it, and how much of its log an error keeps. */
export const FFMPEG_QUIT_EXIT = 255;
export const FFMPEG_LOG_CHARS = 400;
export const TIMED_OUT = "ETIMEDOUT";

/** HTTP statuses that mean the key is missing or rejected, and how much of an error body to keep. */
export const UNAUTHORIZED = 401;
export const FORBIDDEN = 403;
export const HTTP_BODY_CHARS = 200;
export const AUTH_RE: RegExp = /unauthorized|invalid.?api.?key|authentication|missing_permissions/i;

/** The engine `LISTEN_STT` can force; any other value picks automatically. */
export const STT_LOCAL = "local";
export const STT_OPENAI = "openai";
export const STT_AUTO = "auto";
export const FLAG_TRUE = "true";

export const USAGE =
  "usage: listen whoami | devices | rec [--seconds N] [--device D] [--clip] | start [--device D] | stop [--clip] | toggle [--clip] | status | file --path P [--clip] | latest";
export const SETUP = "bun repo setup listen";
export const LISTEN_DIR = ".tmp/repo/listen";
export const SESSION_FILE = "session.json";
export const JSON_INDENT = 2;
export const LATEST_FILE = "latest.txt";
export const FFMPEG_LOG = "ffmpeg.log";
export const NEED_STT =
  "missing whisper-cli (mac: brew install whisper-cpp) or OPENAI_API_KEY / ~/.workerstack/speak.json openai.apiKey. setup: bun repo setup listen";
export const NEED_FFMPEG =
  "missing ffmpeg. mac: brew install ffmpeg · linux: sudo apt install ffmpeg · win: winget install Gyan.FFmpeg. setup: bun repo setup listen";
export const NEED_OPENAI =
  "missing OPENAI_API_KEY (or ~/.workerstack/speak.json openai.apiKey). setup: bun repo setup listen";
export const NEED_GGML =
  "whisper-cli found but no ggml model (auto-download failed). set WHISPER_MODEL or retry. setup: bun repo setup listen";
export const NEED_DEVICE =
  "missing --device or LISTEN_DEVICE. run: bun repo listen devices. setup: bun repo setup listen";
export const NEED_AUDIO = "transcribe needs an audio file";

/** The ffmpeg arguments around the input: quiet logs first, then 16 kHz mono 16-bit PCM. */
export const FFMPEG_QUIET: readonly string[] = ["-hide_banner", "-loglevel", "warning"];
export const FFMPEG_PCM: readonly string[] = ["-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"];
/** The ffmpeg arguments that list each platform's capture devices. */
export const AVFOUNDATION_LIST: readonly string[] = ["-f", "avfoundation", "-list_devices", "true", "-i", ""];
export const DSHOW_LIST: readonly string[] = ["-list_devices", "true", "-f", "dshow", "-i", "dummy"];
export const PACTL_LIST: readonly string[] = ["list", "short", "sources"];
/** The linux clipboard sinks, tried in order. */
export const CLIP_SINKS: readonly (readonly [string, readonly string[]])[] = [
  ["wl-copy", []],
  ["xclip", ["-selection", "clipboard"]],
  ["xsel", ["--clipboard", "--input"]],
];
/** The fallback when pactl lists no source. */
export const PULSE_DEFAULT: Readonly<AudioDevice> = { id: "default", name: "pulse default" };
