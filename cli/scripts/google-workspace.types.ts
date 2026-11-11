/** A loose JSON object, as Google's replies and the token files are read. */
export type Rec = Record<string, unknown>;

/** A stored OAuth refresh token plus where it was read from. */
export type Token = Rec & {
  refresh_token: string;
  client_id: string;
  _path: string;
  _clasprc?: true;
};

export type SpawnSyncOpts = {
  stdio: "ignore";
  windowsVerbatimArguments?: boolean;
};

/** The slice of `spawnSync` this tool uses; `status` is the child's exit code. */
export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { stdio?: "ignore" | "inherit"; encoding?: "utf8"; windowsVerbatimArguments?: boolean },
) => { status: number | null };

/** Which stored account a call reads and writes, and the home it lives under. */
export type WorkspaceAccount = {
  id: string;
  home: string;
};

export type FileSpec = {
  kind: string;
  title?: string | undefined;
  csv?: string | undefined;
  body?: string | undefined;
};

export type MeetingSpec = {
  title?: string | undefined;
  start?: string | undefined;
  end?: string | undefined;
  when?: string | undefined;
  attendees?: string | undefined;
};

/** One Google API reply: its status, its JSON body, and whether the status is 2xx. */
export type GResult = {
  status: number;
  json: Rec;
  ok: boolean;
};

/** The `--name value` flags of one invocation; a bare `--name` is `"1"`. */
export type Flags = Record<string, string>;

export type ParsedArgv = { _: string[]; flags: Flags };

/** What one verb needs: the account, the flags and the spawn for logins. */
export type VerbCtx = { account: WorkspaceAccount; flags: Flags; spawn: SpawnFn };

/** One verb's handler; it prints and returns the exit code. */
export type Verb = (ctx: VerbCtx) => Promise<number>;
