import { calculateWeeklyPoints } from "./calculate-weekly-points";

async function runWeeklyPoints(env: Env) {
	try {
		await calculateWeeklyPoints(env);
	} catch (error) {
		console.error("[weekly-points] run failed", error);
		throw error;
	}
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.pathname === "/__health") {
			return new Response("ok", { status: 200 });
		}

		if (url.pathname === "/admin/run-weekly-points" && request.method === "POST") {
			ctx.waitUntil(runWeeklyPoints(env));
			return new Response(
				JSON.stringify({ status: "scheduled" }),
				{ status: 202, headers: { "content-type": "application/json" } },
			);
		}

		return new Response("Points worker ready", { status: 200 });
	},

	async scheduled(_event, env): Promise<void> {
		await runWeeklyPoints(env);
	},
} satisfies ExportedHandler<Env>;
