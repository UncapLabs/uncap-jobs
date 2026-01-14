/**
 * LTV Alert State Management
 *
 * Persists alert state to KV store to track which positions have been alerted.
 * Enables hysteresis: alert once on threshold crossing, reset when LTV drops below.
 *
 * Tracks alerts per individual trove ID (e.g., "0:0x123...") not per branch.
 */

import type { KVNamespace } from '@cloudflare/workers-types';

export interface AlertState {
	/** Map of trove ID to whether it has been alerted for crossing threshold */
	alertedPositions: Record<string, boolean>;
	/** Last time the LTV check ran (ISO string) */
	lastCheck: string;
	/** Last time a summary was sent (ISO string) */
	lastSummary: string;
}

const DEFAULT_STATE: AlertState = {
	alertedPositions: {},
	lastCheck: '',
	lastSummary: '',
};

/**
 * Get network-prefixed cache key to prevent staging/production data mixing.
 */
function getStateKey(network: string): string {
	return `${network}:ltv-alert-state`;
}

/**
 * Load alert state from KV store.
 * Returns default state if key doesn't exist.
 */
export async function loadAlertState(kv: KVNamespace, network: string): Promise<AlertState> {
	try {
		const key = getStateKey(network);
		const cached = await kv.get(key, 'json');

		if (!cached) {
			console.log('[ltv-state] No existing state found, using defaults');
			return { ...DEFAULT_STATE };
		}

		const state = cached as AlertState;
		// Ensure alertedPositions exists (migration from old format)
		if (!state.alertedPositions || typeof state.alertedPositions !== 'object') {
			state.alertedPositions = {};
		}
		console.log('[ltv-state] Loaded existing state with', Object.keys(state.alertedPositions).length, 'tracked positions');
		return state;
	} catch (error) {
		console.warn('[ltv-state] Error loading state, using defaults:', error);
		return { ...DEFAULT_STATE };
	}
}

/** State expires after 7 days - acts as a weekly reminder for high LTV positions */
const STATE_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

/**
 * Save alert state to KV store.
 * Expires after 7 days so you get a reminder for positions still above threshold.
 */
export async function saveAlertState(kv: KVNamespace, network: string, state: AlertState): Promise<void> {
	try {
		const key = getStateKey(network);
		await kv.put(key, JSON.stringify(state), { expirationTtl: STATE_EXPIRY_SECONDS });
		console.log('[ltv-state] State saved successfully (expires in 7 days)');
	} catch (error) {
		console.error('[ltv-state] Error saving state:', error);
		throw error;
	}
}

/**
 * Check if a position has been alerted.
 */
export function isPositionAlerted(state: AlertState, troveId: string): boolean {
	return state.alertedPositions[troveId] === true;
}

/**
 * Mark a position as alerted.
 */
export function markPositionAlerted(state: AlertState, troveId: string): void {
	state.alertedPositions[troveId] = true;
}

/**
 * Clear alert flag for a position.
 */
export function clearPositionAlert(state: AlertState, troveId: string): void {
	state.alertedPositions[troveId] = false;
}
