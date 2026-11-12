export const DRIVE = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
export const SHEETS = "https://sheets.googleapis.com/v4";
export const DOCS = "https://docs.googleapis.com/v1";
export const CALENDAR = "https://www.googleapis.com/calendar/v3";
export const GMAIL = "https://gmail.googleapis.com/gmail/v1";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
export const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
export const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const CALENDAR_TEMPLATE_URL = "https://calendar.google.com/calendar/render?action=TEMPLATE";

/** Extra clasp login scopes. Clasp's default consent is Apps Script + Drive only. */
export const EXTRA_SCOPES: string[] = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/tasks",
];

export const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
export const PROFILE_SCOPE = "https://www.googleapis.com/auth/userinfo.profile";
export const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export const KIND_DOC = "doc";
export const KIND_SHEET = "sheet";
export const KIND_SLIDE = "slide";

/** The Drive type each file kind is made as. */
const MIME = {
  [KIND_DOC]: "application/vnd.google-apps.document",
  [KIND_SHEET]: "application/vnd.google-apps.spreadsheet",
  [KIND_SLIDE]: "application/vnd.google-apps.presentation",
} as const satisfies Readonly<Record<string, string>>;

function isKind(kind: string): kind is keyof typeof MIME {
  return Object.hasOwn(MIME, kind);
}

/** The Drive type a file of `kind` is made as, or undefined when `kind` is none of doc, sheet and slide. */
export function mimeOf(kind: string): string | undefined {
  return isKind(kind) ? MIME[kind] : undefined;
}

export const CSV_TYPE = "text/csv";
export const TEXT_TYPE = "text/plain; charset=UTF-8";
export const FORM_TYPE = "application/x-www-form-urlencoded";

/** The platforms `openUrl` opens a URL on differently. */
export const DARWIN: NodeJS.Platform = "darwin";
export const WIN32: NodeJS.Platform = "win32";

export const DEFAULT_ACCOUNT = "default";
export const ACCOUNT_RE: RegExp = /^[a-zA-Z0-9_-]{1,40}$/;
export const ADC_USER = "authorized_user";

/** The bookkeeping fields a token carries in memory and never writes back. */
export const TOKEN_META: readonly string[] = ["sourcePath", "isClasprc"];

export const SECRET_DIR_MODE = 0o700;
export const SECRET_FILE_MODE = 0o600;
export const JSON_INDENT = 2;
export const MS_PER_SECOND = 1000;

/** A cached access token is reused only while it has more than this left. */
export const EXPIRY_SLACK_MS = 60_000;

/** The token lifetime assumed when a reply names none, in seconds. */
export const DEFAULT_LIFETIME_S = 3600;
export const HOUR_MS = 3_600_000;
export const VERIFIER_BYTES = 32;
export const LOGIN_TIMEOUT_MS = 180_000;
export const HTTP_OK = 200;
export const HTTP_MULTIPLE = 300;

/** How much of a non-JSON reply is kept for the error. */
export const RAW_REPLY_CHARS = 400;
export const DRIVE_PAGE = 10;
export const MAIL_PAGE = 5;

export const ARG_END = "--";
export const FLAG_PREFIX = "--";
export const FLAG_SET = "1";
export const FLAG_PREFIX_LEN: number = FLAG_PREFIX.length;

export const LINE_RE: RegExp = /\r?\n/;
export const SPACES_RE: RegExp = /\s+/;
export const STAMP_PUNCT_RE: RegExp = /[-:]/g;
export const STAMP_MS_RE: RegExp = /\.\d{3}Z$/;
export const PAD_RE: RegExp = /=+$/;
export const ATTENDEE_SPLIT_RE: RegExp = /[,;\s]+/;

/** What `repo google-workspace` takes. */
export const GOOGLE_WORKSPACE_ARGS: string =
  "[--account NAME] whoami | scopes | accounts | login | " +
  "sheet create --title T [--csv csv] | sheet set --id ID --cell A1 --value V | " +
  "sheet get --id ID [--range A1:B2] | sheet append --id ID --csv csv | sheet clear --id ID [--range A1:Z] | " +
  "doc create --title T [--body text] | doc append --id ID --body text | drive list [--query Q] | " +
  "slide create --title T | meeting create --title T [--start ISO --end ISO] [--attendees a@b,c@d] | " +
  "mail send --to E --subject S --body T | mail list";

export const USAGE: string = `usage: google-workspace ${GOOGLE_WORKSPACE_ARGS}`;
