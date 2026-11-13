import { CONFIG_FILE } from "./config.constants.ts";

/** Where `repo check` reads the manifest and license from, and the config file it points owner problems at. */
export const MANIFEST_FILE = "package.json";
export const LICENSE_FILE = "LICENSE";

export const LICENSE_ID = "MIT";
export const MODULE_TYPE = "module";
export const REPOSITORY_TYPE = "git";
export const PUBLISH_ACCESS = "public";
export const GIT_URL_PREFIX = "git+https://";
export const HTTPS_PREFIX = "https://";
export const TYPES_CONDITION = "types";
export const MANIFEST_EXPORT = "./package.json";
export const SUBPATH_PREFIX = ".";
export const REPOSITORY_FIX = 'set it to { "type": "git", "url": "git+https://…" }';
export const BUGS_FIX = 'set it to { "url": "…/issues" }';

/** The `owner` fields a public release-pack root must set. */
const OWNER_FIELDS = "owner: { name, github }";

/** The line `repo check` prints when a public release-pack root has no `owner`. */
export const OWNER_MISSING: string = `${CONFIG_FILE}: the release pack with a public package needs ${OWNER_FIELDS}`;

/** The MIT license text after its copyright line, whitespace-normalized; a LICENSE must contain it whole. */
export const MIT_BODY: string =
  "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and " +
  'associated documentation files (the "Software"), to deal in the Software without restriction, ' +
  "including without limitation the rights to use, copy, modify, merge, publish, distribute, " +
  "sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is " +
  "furnished to do so, subject to the following conditions: The above copyright notice and this " +
  "permission notice shall be included in all copies or substantial portions of the Software. THE " +
  'SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT ' +
  "LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. " +
  "IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER " +
  "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN " +
  "CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.";

/** Runs of whitespace, which a LICENSE may wrap or indent any way. */
export const WHITESPACE: RegExp = /\s+/g;
