/**
 * Telegram Notification Utility
 *
 * Sends messages to a Telegram chat using the Bot API.
 */

export interface TelegramConfig {
	botToken: string;
	chatId: string;
}

/**
 * Send a message to Telegram.
 * Uses HTML parse mode for formatting.
 */
export async function sendTelegramAlert(config: TelegramConfig, message: string): Promise<void> {
	const { botToken, chatId } = config;

	if (!botToken || !chatId) {
		console.warn('[telegram] Bot token or chat ID not configured, skipping notification');
		return;
	}

	const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			chat_id: chatId,
			text: message,
			parse_mode: 'HTML',
		}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Telegram API error: ${response.status} - ${errorText}`);
	}

	console.log('[telegram] Message sent successfully');
}
