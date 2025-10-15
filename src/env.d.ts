import type { D1Database } from "@cloudflare/workers-types";

declare global {
	interface Env {
		DB: D1Database;
		DUNE_API_KEY?: string;
		DUNE_QUERY_CDP_ID?: string;
	}
}

export {};
