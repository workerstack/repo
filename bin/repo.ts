#!/usr/bin/env bun
import { main } from "../cli/bin.ts";
import { ARGV_START } from "../cli/main.constants.ts";

await main(process.argv.slice(ARGV_START));
