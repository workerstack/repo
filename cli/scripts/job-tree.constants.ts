/**
 * Lists every process as `pid parentPid`, one per line (PowerShell: a process keeps its parent pid after the parent
 * dies).
 */
const LIST_PROCESSES_SCRIPT =
  'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }';

export const POWERSHELL = "powershell";
export const POWERSHELL_ARGS: string[] = ["-NoProfile", "-NonInteractive", "-Command", LIST_PROCESSES_SCRIPT];
export const LIST_TIMEOUT_MS = 5000;
export const TASKKILL = "taskkill";

/** Ends the pids named after it, with their trees. */
export const TASKKILL_FLAGS: string[] = ["/F", "/T"];
export const PID_FLAG = "/PID";
