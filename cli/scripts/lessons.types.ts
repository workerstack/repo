/** One parsed lesson file. */
export type Lesson = {
  name: string;
  paths: string[];
  hits: number;
  lastHit: string;
  evidence: string[];
  title: string;
  summary: string;
  mistake: string;
  fix: string;
};

export type ParsedLesson = { ok: true; lesson: Lesson } | { ok: false; errors: string[] };

/** One INDEX.md row. */
export type IndexRow = {
  file: string;
  paths: string[];
  hits: number;
  lastHit: string;
  summary: string;
};

/** The roots `resolveRoots` returns. */
export type Roots = {
  root: string;
  checkout: string;
  cwd: string;
};

export type LessonResult =
  | { ok: true; path: string; content: string; error?: undefined }
  | { ok: false; error: string; path?: undefined; content?: undefined };
export type HitResult =
  | { ok: true; path: string; hits: number; error?: undefined }
  | { ok: false; error: string; path?: undefined; hits?: undefined };
export type RemoveResult = { ok: true; error?: undefined } | { ok: false; error: string };

/** A lesson file's frontmatter keys and the body after it. */
export type Frontmatter = { map: Record<string, string>; body: string };

/** A lesson body split into its title, summary and sections, with what is wrong with it. */
export type LessonBody = { errors: string[]; fix: string; mistake: string; summary: string; title: string };

/** The frontmatter fields of a lesson; a list is null when it is not a JSON list of strings. */
export type LessonFields = {
  evidence: string[] | null;
  hits: number;
  lastHit: string;
  name: string;
  paths: string[] | null;
};

/** What `matchLessons` takes: the roots (or one checkout) and the files to match, at most `cap` rows. */
export type MatchOptions = (
  | { roots: Roots; workspaceRoot?: undefined }
  | { roots?: undefined; workspaceRoot: string }
) & {
  files: string[];
  cap?: number;
};

/** A lesson Write: the checkout, the file it names and the text, dated `today`. */
export type PersistInput = { workspaceRoot: string; filePath: string; content: unknown; today?: string };

/** Another occurrence of lesson `slug`, with its evidence, dated `today`. */
export type HitInput = { workspaceRoot: string; slug: string; evidence: string; today?: string };

/** `pending` maps a lesson filename to text the host is about to write. */
export type IndexInput = { workspaceRoot: string; pending?: Record<string, string> };
