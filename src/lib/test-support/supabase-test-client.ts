import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/database.types";

type Client = SupabaseClient<Database>;

export interface TestUser {
  id: string;
  email: string;
  password: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — copy .env.test.example to .env.test and fill in local Supabase values`);
  }
  return value;
}

/** Admin (service-role) client for creating/deleting throwaway test users. Local Supabase only. */
export function createAdminClient(): Client {
  const url = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Creates a fresh, isolated throwaway Supabase Auth user for one test case. */
export async function createTestUser(admin: Client): Promise<TestUser> {
  const email = `test-${crypto.randomUUID()}@example.com`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return { id: data.user.id, email, password };
}

/** Deletes a throwaway test user; cascades its meals/check-ins via the schema's FKs. */
export async function deleteTestUser(admin: Client, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
}

/** Signs in as a throwaway test user, returning a plain, request-authenticated client. */
export async function signInTestUser(email: string, password: string): Promise<Client> {
  const url = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_KEY");
  const client = createClient<Database>(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}
