/** `repo yolo`'s manifest, argv and report shapes. */
import type { JSON_FORMAT, TOML_FORMAT } from "./sync-global-settings.constants.ts";

export type SettingsFormat = typeof JSON_FORMAT | typeof TOML_FORMAT;

/** One host in the manifest: the payload file in the repo and the dotfile under $HOME it merges into. */
export type ManifestHost = {
  id: string;
  format: SettingsFormat;
  payload: string;
  dest: string;
};

export type Manifest = {
  skipKeyPattern: string;
  hosts: ManifestHost[];
};

export type ParsedArgv = { ok: true; dryRun: boolean; check: boolean; host: string } | { ok: false; error: string };

export type ReportRow = {
  action: string;
  id: string;
  dest: string;
  line: string;
};

export type SyncResult = {
  ok: boolean;
  report: ReportRow[];
  error?: string;
};

/** Where `syncGlobals` reads and writes, and what it does. */
export type SyncOptions = {
  workspaceRoot?: string;
  sourceRoot?: string;
  consumerRoot?: string;
  home?: string;
  apply?: boolean;
  host?: string;
};
