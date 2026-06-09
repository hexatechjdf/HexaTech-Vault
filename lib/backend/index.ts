// Backend factory. Returns a singleton implementing the Backend contract, chosen by config.
// Default = MockBackend (runs with no cloud setup). Set NEXT_PUBLIC_BACKEND_MODE=supabase to use the real one.

import { BACKEND_MODE } from "../config";
import type { Backend } from "./contract";
import { MockBackend } from "./mockBackend";
import { SupabaseBackend } from "./supabaseBackend";

let instance: Backend | null = null;

export function getBackend(): Backend {
  if (!instance) {
    instance = BACKEND_MODE === "supabase" ? new SupabaseBackend() : new MockBackend();
  }
  return instance;
}

export type { Backend, GrantInput, ListResult } from "./contract";
export { PermissionError } from "./contract";
