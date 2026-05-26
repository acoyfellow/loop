import { betterAuth } from "better-auth";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { getRequestEvent } from "$app/server";
import { account, session, user, verification } from "./schema";
import type { D1Database } from "@cloudflare/workers-types";

export function initAuth(db: D1Database, env: { BETTER_AUTH_SECRET?: string } | undefined, baseURL: string) {
  if (!db) throw new Error("D1 database is required for authentication.");
  const secret = typeof env?.BETTER_AUTH_SECRET === "string" ? env.BETTER_AUTH_SECRET : undefined;
  if (!secret) throw new Error("BETTER_AUTH_SECRET environment variable is required.");
  const database = drizzle(db, { schema: { user, session, account, verification } });

  return betterAuth({
    trustedOrigins: ["http://127.0.0.1:5176", "http://localhost:5173", "https://*.coey.dev"],
    database: drizzleAdapter(database, {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      requireEmailVerification: false,
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    secret,
    baseURL,
    plugins: [sveltekitCookies(getRequestEvent as never)],
  });
}
