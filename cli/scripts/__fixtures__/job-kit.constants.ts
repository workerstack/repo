/** The file in a planted tool's dir where each run of the stub appends its pid, one per line. */
export const PID_FILE = "pids.txt";
/** How long the cleanup waits for a killed stub to be gone, and how often it looks. */
export const STUB_EXIT_WAIT_MS = 5000;
export const STUB_EXIT_POLL_MS = 25;
export const NO_SUCH_PROCESS = "ESRCH";
