#!/usr/bin/env bun
import { main } from "../cli/bin.ts";

await main(process.argv.slice(2));
