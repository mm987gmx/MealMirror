import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/database.types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — copy .env.test.example to .env.test and fill in local Supabase values`);
  }
  return value;
}

interface CapturedCookie {
  name: string;
  value: string;
}

/**
 * Builds a real, correctly-encoded `Cookie` header for a signed-in user, for use
 * against route handlers that build their Supabase client from request cookies
 * (see src/lib/supabase.ts). Reuses @supabase/ssr's own browser-client cookie
 * serialization (via a fake cookie store) instead of reimplementing its
 * version-specific chunked/base64url encoding by hand.
 */
export async function buildSessionCookieHeader(email: string, password: string): Promise<string> {
  const url = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_KEY");
  const captured: CapturedCookie[] = [];

  const client = createBrowserClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => captured,
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          captured.push({ name, value });
        }
      },
    },
  });

  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;

  if (captured.length === 0) {
    throw new Error(
      "Sign-in produced no session cookies — @supabase/ssr's cookie encoding may have changed; re-check buildSessionCookieHeader",
    );
  }

  return captured.map(({ name, value }) => `${name}=${value}`).join("; ");
}

export interface FakeApiContext {
  request: Request;
  locals: { user: { id: string } };
  cookies: { set: () => void };
  redirect: (url: string) => Response;
}

/**
 * Minimal stand-in for Astro's APIContext, carrying only the properties
 * src/pages/api/meals.ts and src/pages/api/check-ins/collision.ts read.
 */
export function buildFakeApiContext({ request, userId }: { request: Request; userId: string }): FakeApiContext {
  return {
    request,
    locals: { user: { id: userId } },
    cookies: { set: () => undefined },
    redirect: (url: string) => new Response(null, { status: 302, headers: { Location: url } }),
  };
}
