import { calculateWeeklyPoints } from './calculate-weekly-points';
import { exportPointsSnapshot } from './export-points-snapshot';
import { generateWeeklyRewards } from './generate-weekly-rewards';

async function runWeeklyPoints(env: Env, referenceDate?: Date, force = false) {
	try {
		await calculateWeeklyPoints(env, { referenceDate, force });
	} catch (error) {
		console.error('[weekly-points] run failed', error);
		throw error;
	}
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (url.pathname === '/__health') {
			return new Response('ok', { status: 200 });
		}

		if (url.pathname === '/admin/run-weekly-points' && request.method === 'POST') {
			const referenceParam = url.searchParams.get('reference');
			const forceParam = url.searchParams.get('force');
			let referenceDate: Date | undefined;
			const force = forceParam === 'true' || forceParam === '1';

			if (referenceParam) {
				const parsed = new Date(referenceParam);
				if (Number.isNaN(parsed.getTime())) {
					return new Response(JSON.stringify({ error: 'Invalid reference date' }), {
						status: 400,
						headers: { 'content-type': 'application/json' },
					});
				}
				referenceDate = parsed;
			}

			ctx.waitUntil(runWeeklyPoints(env, referenceDate, force));
			return new Response(JSON.stringify({ status: 'scheduled' }), { status: 202, headers: { 'content-type': 'application/json' } });
		}

		return new Response('Points worker ready', { status: 200 });
	},

	async scheduled(event, env): Promise<void> {
		if (event.cron === '0 18 * * FRI') {
			const referenceDate = event.scheduledTime ? new Date(event.scheduledTime) : undefined;
			await exportPointsSnapshot(env, { referenceDate });
			return;
		}

		if (event.cron === '0 16 * * THU') {
			const referenceDate = event.scheduledTime ? new Date(event.scheduledTime) : undefined;
			await generateWeeklyRewards(env, { referenceDate });
			return;
		}

		await runWeeklyPoints(env);
	},
} satisfies ExportedHandler<Env>;
