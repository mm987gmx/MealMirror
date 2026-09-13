#!/usr/bin/env node
// Starts local Supabase automatically for `npm test`/`npm run test:e2e` when
// it isn't already running. Never stops it — a developer may be relying on
// an already-running instance for other work.
import { execSync } from "node:child_process";

function isSupabaseRunning() {
  try {
    execSync("npx supabase status", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!isSupabaseRunning()) {
  console.log("Local Supabase is not running — starting it (npx supabase start)...");
  execSync("npx supabase start", { stdio: "inherit" });
} else {
  console.log("Local Supabase is already running — leaving it as is.");
}
