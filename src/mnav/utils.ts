/**
 * mNAV Calculator Utilities
 */

import Big from 'big.js';

// Configure Big.js precision (18 decimals matches Starknet token precision)
Big.DP = 18;
Big.RM = Big.roundDown;

/**
 * Retry a function with exponential backoff.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	label: string,
	maxRetries = 3,
	delayMs = 1000
): Promise<T> {
	let lastError: Error | undefined;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error as Error;
			console.warn(`[mnav] ${label} attempt ${attempt}/${maxRetries} failed:`, error);

			if (attempt < maxRetries) {
				await new Promise((r) => setTimeout(r, delayMs * attempt));
			}
		}
	}

	throw new Error(`[mnav] ${label} failed after ${maxRetries} attempts: ${lastError?.message}`);
}

export { Big };
