import { DENY_PIN, LLVM_COV_PIN, NEXTEST_PIN, SHEAR_PIN } from "../rust/cargo-tools.constants.ts";

/** The rust-cache action's pin: a full commit SHA with its release as the comment. */
const RUST_CACHE: string = "Swatinem/rust-cache@d1527c8f67ef9af357290475d4af4b0fab8f12e0 # v2.9.3";
/** The install-action's pin: a full commit SHA with its release as the comment. */
const INSTALL_ACTION: string = "taiki-e/install-action@cfdb7ed4ccc7c7dce37759eae89dc5674b469b39 # v2.90.3";
/** The cargo-hack release the msrv job runs; bumping it is a repo release. */
const HACK_VERSION: string = "0.6.46";
/** The `name:` the msrv job is reported under, the status check name a ruleset requires. */
export const MSRV_JOB: string = "msrv";

/** The tools `repo ci` runs in a Rust repo (supply-chain checks, nextest and llvm-cov), pinned to the versions `repo check` expects. */
const CHECK_TOOLS: string = `cargo-deny@${DENY_PIN.version},cargo-shear@${SHEAR_PIN.version},cargo-nextest@${NEXTEST_PIN.version},cargo-llvm-cov@${LLVM_COV_PIN.version}`;

/** In a Rust repo, right after the install: the cargo cache and the supply-chain tools, once rustup has the toolchain. */
export const RUST_TOOL_STEPS: string = `      - uses: ${RUST_CACHE}
      - uses: ${INSTALL_ACTION}
        with:
          tool: ${CHECK_TOOLS}`;

/** The msrv job's steps after the checkout: every publishable crate is checked on its own rust-version. */
export const MSRV_STEPS: string = `      - uses: ${RUST_CACHE}
      - uses: ${INSTALL_ACTION}
        with:
          tool: cargo-hack@${HACK_VERSION}
      - name: Check each publishable crate on its rust-version
        shell: bash
        run: |
          meta="$(cargo metadata --no-deps --format-version 1 --locked)"
          if jq -e 'any(.packages[]; .publish != [])' <<<"$meta" >/dev/null; then
            cargo hack check --rust-version --workspace --locked --ignore-private
          else
            echo "no publishable crate"
          fi`;
