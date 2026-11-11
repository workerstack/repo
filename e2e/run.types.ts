/** One finished sandbox command: its exit status, its streams, and the log text written for it. */
export type Run = { status: number | null; stdout: string; stderr: string; out: string };
