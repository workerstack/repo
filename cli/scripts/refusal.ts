import { EXIT_REFUSED } from "./changelog.constants.ts";

/** A refusal or usage error: the message to print and the exit code. */
export class Refusal extends Error {
  readonly code: number;

  constructor(message: string, code: number = EXIT_REFUSED) {
    super(message);
    this.code = code;
  }
}
