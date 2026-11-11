import type { Sandbox } from "./sandbox";

/** A suite's one shared sandbox, read when a case runs, since the suite's beforeAll makes it. */
export type GetSandbox = () => Sandbox;
