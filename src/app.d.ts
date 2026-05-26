import type { D1Database } from "@cloudflare/workers-types";
import type { User as BetterAuthUser, Session as BetterAuthSession } from "better-auth";

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
      user: BetterAuthUser | null;
      session: BetterAuthSession | null;
    }
		// interface PageData {}
		// interface PageState {}
		interface Platform {
				env: {
					LOOP: DurableObjectNamespace;
					WORKER: Fetcher;
					DB: D1Database;
          BETTER_AUTH_SECRET?: string;
          LOOP_INVITE_PASSWORD?: string;
          LOOP_INVITE_PASSWORDS?: string;
				};
		}
	}
}

export {};
