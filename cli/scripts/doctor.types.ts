import type { Env } from "../env.ts";

/** One doctor check's outcome; `extra` is the detail printed after the status. */
export type DoctorStatus = {
  ok: boolean;
  extra: string;
};

/** A workspace leftover and the command that clears exactly it. */
export type WorkspaceIssue = {
  kind: string;
  path: string;
  detail: string;
  clear: string;
};

export type DoctorResult = {
  code: number;
  stdout: string;
  stderr: string;
};

/** One tool's install lines on win32 and darwin, and on every other platform. */
export type InstallHints = { darwin?: readonly string[]; other: readonly string[]; win32?: readonly string[] };

export type ModelCli = "codex" | "grok" | "agy" | "cursor";
export type ListCli = Exclude<ModelCli, "codex" | "agy">;

/** A model named in a generated agent file, with the CLI that has to offer it. */
export type ModelRef = {
  cli: ModelCli;
  file: string;
  model: string;
};

/** What a CLI offers (`ids`), or why it was skipped. */
export type Offered = {
  ids?: string[];
  skip?: string;
};

export type ListResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export type ListRunner = (bin: string, args: string[], opts: { signal: AbortSignal }) => Promise<ListResult>;

/** Where `repo doctor` looks: the checkout, the PATH and platform for binaries, the env and home for keys. */
export type DoctorOpts = {
  cwd?: string;
  pathEnv?: string | undefined;
  platform?: string;
  env?: Env;
  home?: string;
  extraLines?: string[];
  /** The `globals` row from `globalsRow`, computed by the caller because it loads check-globals on demand. */
  globals?: string | null;
  /** The skill packs the repo enables (`agents.skills`); their tools get a row. */
  skills?: readonly string[];
};

/** Every agent-models knob, each with a default. */
export type AgentModelsOpts = {
  cwd?: string;
  env?: Env;
  home?: string;
  run?: ListRunner;
  capMs?: number;
  sourceRoot?: string;
};
