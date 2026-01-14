/**
 * LTV Check Job
 *
 * Monitors LTV (Loan-to-Value) for curator's individual positions.
 * Sends Telegram alerts when any position crosses 65% LTV threshold.
 * Sends daily summary with all positions listed individually.
 */

import { fetchIndividualPositions, type TrovePosition } from './fetch-individual-positions';
import { fetchPrices } from '../mnav/prices/uncap-oracle';
import { Big } from '../mnav/utils';
import type { Network } from '../mnav/config';
import { sendTelegramAlert, type TelegramConfig } from '../notifications/telegram';
import {
	loadAlertState,
	saveAlertState,
	isPositionAlerted,
	markPositionAlerted,
	clearPositionAlert,
} from './alert-state';

const LTV_THRESHOLD = 0.65; // 65%
const SUMMARY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface PositionLtvData {
	position: TrovePosition;
	ltv: number;
	debtUsd: number;
	collateralBtc: number;
	collateralUsd: number;
}

/**
 * Calculate LTV for a position.
 * LTV = debt / (collateral * price)
 */
function calculatePositionLtv(position: TrovePosition, priceUsd: number): PositionLtvData {
	// Convert from 18 decimals to human-readable
	const debtUsd = Number(position.debt.div(Big(1e18)).toString());
	const collateralBtc = Number(position.collateral.div(Big(1e18)).toString());
	const collateralUsd = collateralBtc * priceUsd;

	// Calculate LTV (handle zero collateral)
	const ltv = collateralUsd > 0 ? debtUsd / collateralUsd : 0;

	return {
		position,
		ltv,
		debtUsd,
		collateralBtc,
		collateralUsd,
	};
}

/**
 * Format a threshold crossing alert message for an individual position.
 */
function formatThresholdAlert(data: PositionLtvData, priceUsd: number): string {
	const ltvPercent = (data.ltv * 100).toFixed(2);
	const thresholdPercent = (LTV_THRESHOLD * 100).toFixed(0);

	return [
		'🚨 <b>HIGH LTV ALERT</b>',
		'',
		`<b>Position:</b> ${data.position.displayName} #${data.position.shortId}`,
		`<b>Current LTV:</b> ${ltvPercent}%`,
		`<b>Threshold:</b> ${thresholdPercent}%`,
		'',
		`<b>Debt:</b> ${data.debtUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDU`,
		`<b>Collateral:</b> ${data.collateralBtc.toFixed(5)} ${data.position.displayName} ($${data.collateralUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })})`,
		'',
		`<b>BTC/USD:</b> $${priceUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
		'',
		'⚠️ Action needed: Consider rebalancing position.',
	].join('\n');
}

/**
 * Format the daily summary message with individual positions.
 */
function formatSummary(allData: PositionLtvData[], priceUsd: number): string {
	const lines = ['📊 <b>DAILY LTV SUMMARY</b>', ''];

	if (allData.length === 0) {
		lines.push('No active positions found.');
	} else {
		// Group by collateral type for cleaner display
		const byCollateral = new Map<string, PositionLtvData[]>();
		for (const data of allData) {
			const key = data.position.displayName;
			if (!byCollateral.has(key)) {
				byCollateral.set(key, []);
			}
			byCollateral.get(key)!.push(data);
		}

		for (const [collateral, positions] of byCollateral) {
			lines.push(`━━━ <b>${collateral}</b> ━━━`);

			for (const data of positions) {
				const ltvPercent = (data.ltv * 100).toFixed(2);
				const status = data.ltv >= LTV_THRESHOLD ? '⚠️' : '✅';

				lines.push(`  #${data.position.shortId}: ${ltvPercent}% ${status}`);
				lines.push(`    Debt: ${data.debtUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} USDU`);
				lines.push(`    Coll: ${data.collateralBtc.toFixed(5)} ${collateral}`);
			}

			lines.push('');
		}
	}

	lines.push(`<b>BTC/USD:</b> $${priceUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);

	return lines.join('\n');
}

/**
 * Check if enough time has passed since last summary (24 hours).
 */
function shouldSendSummary(lastSummary: string): boolean {
	if (!lastSummary) return true;

	const lastTime = new Date(lastSummary).getTime();
	const now = Date.now();

	return now - lastTime >= SUMMARY_INTERVAL_MS;
}

/**
 * Main LTV check job.
 * Fetches individual positions, calculates LTV, sends alerts if needed.
 * Threshold alerts are sent immediately, summary is sent once per day.
 */
export async function checkLtvAlerts(env: Env): Promise<void> {
	console.log('[ltv-check] Starting LTV check...');

	const network = (env.NETWORK as Network) || 'sepolia';
	const rpcUrl = env.STARKNET_RPC_URL;
	const curatorAddress = env.CURATOR_STARKNET_ADDRESS;

	// Validate required env vars
	if (!rpcUrl || !curatorAddress) {
		console.error('[ltv-check] Missing STARKNET_RPC_URL or CURATOR_STARKNET_ADDRESS');
		return;
	}

	// Access Telegram credentials from env (Cloudflare native way)
	const telegramConfig: TelegramConfig = {
		botToken: env.TELEGRAM_BOT_TOKEN_CRITICAL_ALERTS,
		chatId: env.TELEGRAM_CHAT_ID_CRITICAL_ALERTS,
	};

	if (!telegramConfig.botToken || !telegramConfig.chatId) {
		console.error('[ltv-check] Missing Telegram credentials');
		return;
	}

	if (!env.CACHE) {
		console.error('[ltv-check] CACHE KV namespace not configured');
		return;
	}

	try {
		// Fetch individual positions and prices in parallel
		const [positionsResult, pricesResult] = await Promise.all([
			fetchIndividualPositions(rpcUrl, curatorAddress, network),
			fetchPrices(rpcUrl, network),
		]);

		const positions = positionsResult.positions;
		const priceUsd = Number(pricesResult.prices.wbtcUsd.div(Big(1e18)).toString());

		console.log(`[ltv-check] BTC/USD price: $${priceUsd.toLocaleString()}`);
		console.log(`[ltv-check] Found ${positions.length} active positions`);

		// Calculate LTV for each position
		const allLtvData: PositionLtvData[] = positions.map((pos) => calculatePositionLtv(pos, priceUsd));

		// Log LTV values
		for (const data of allLtvData) {
			console.log(
				`[ltv-check] ${data.position.displayName} #${data.position.shortId}: LTV = ${(data.ltv * 100).toFixed(2)}%`
			);
		}

		// Load alert state from KV (expires after 7 days for weekly reminders)
		const state = await loadAlertState(env.CACHE, network);

		// Check for threshold crossings (with hysteresis)
		for (const data of allLtvData) {
			const wasAlerted = isPositionAlerted(state, data.position.id);

			if (data.ltv >= LTV_THRESHOLD && !wasAlerted) {
				// Crossing threshold - send alert immediately
				console.log(
					`[ltv-check] ${data.position.displayName} #${data.position.shortId} crossed ${LTV_THRESHOLD * 100}% threshold, sending alert`
				);

				const alertMessage = formatThresholdAlert(data, priceUsd);
				await sendTelegramAlert(telegramConfig, alertMessage);

				markPositionAlerted(state, data.position.id);
			} else if (data.ltv < LTV_THRESHOLD && wasAlerted) {
				// Dropped below threshold - reset flag
				console.log(
					`[ltv-check] ${data.position.displayName} #${data.position.shortId} dropped below threshold, resetting alert flag`
				);
				clearPositionAlert(state, data.position.id);
			}
		}

		// Send daily summary (only once per 24 hours)
		if (shouldSendSummary(state.lastSummary)) {
			const summaryMessage = formatSummary(allLtvData, priceUsd);
			await sendTelegramAlert(telegramConfig, summaryMessage);
			state.lastSummary = new Date().toISOString();
			console.log('[ltv-check] Daily summary sent');
		} else {
			console.log('[ltv-check] Skipping summary (already sent within last 24h)');
		}

		// Update state
		state.lastCheck = new Date().toISOString();
		await saveAlertState(env.CACHE, network, state);

		console.log('[ltv-check] LTV check completed successfully');
	} catch (error) {
		console.error('[ltv-check] Error during LTV check:', error);
		throw error;
	}
}
