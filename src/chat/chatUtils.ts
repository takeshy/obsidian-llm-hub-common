import type { Message } from "../core/message.js";

/** Provider names a host may use for a persistent CLI session. Hosts without CLIs use none. */
export type ChatProvider = string;
import { formatError } from "../core/index.js";
import { t } from "../i18n/index.js";

// Keywords that trigger automatic image model switching
export const IMAGE_KEYWORDS = [
	// Japanese
	"画像を生成", "画像を作成", "画像を描", "イラストを", "絵を描",
	"写真を生成", "写真を作成", "画像にして",
	// English
	"generate image", "create image", "draw image",
	"generate a picture", "create a picture", "make an image",
	// German
	"bild generieren", "bild erstellen",
	// Spanish
	"generar imagen", "crear imagen",
	// French
	"générer une image", "créer une image",
	// Italian
	"genera immagine", "crea immagine",
	// Korean
	"이미지 생성", "그림 그려",
	// Portuguese
	"gerar imagem", "criar imagem",
	// Chinese
	"生成图片", "创建图片",
];

export function shouldUseImageModel(message: string): boolean {
	const lower = message.toLowerCase();
	return IMAGE_KEYWORDS.some(kw => lower.includes(kw));
}

/** Keep the current message plus at most the requested number of older messages. */
export function limitConversationHistory(messages: Message[], maxPreviousMessages: number): Message[] {
	if (messages.length === 0) return [];
	const limit = Math.max(0, Math.min(99, Math.trunc(maxPreviousMessages)));
	return messages.slice(-(limit + 1));
}

export function isCaretOnFirstLine(value: string, caret: number): boolean {
	return !value.slice(0, caret).includes("\n");
}

export function isCaretOnLastLine(value: string, caret: number): boolean {
	return !value.slice(caret).includes("\n");
}

export const PAID_RATE_LIMIT_RETRY_DELAYS_MS = [10000, 30000, 60000];

export const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function isRateLimitError(error: unknown): boolean {
	if (error && typeof error === "object" && "code" in error) {
		const code = (error as { code?: unknown }).code;
		if (code === 429 || code === "429") {
			return true;
		}
	}
	if (error && typeof error === "object" && "status" in error) {
		const rawStatus = (error as { status?: unknown }).status;
		const status = typeof rawStatus === "string" || typeof rawStatus === "number"
			? String(rawStatus)
			: "";
		if (status === "429" || status.toUpperCase() === "RESOURCE_EXHAUSTED") {
			return true;
		}
	}
	const message = formatError(error);
	return (
		/\b429\b/.test(message) ||
		/RESOURCE_EXHAUSTED/i.test(message) ||
		/rate limit/i.test(message)
	);
}

/**
 * Some 429 responses are short-lived rate limits, while others are hard quota
 * failures (daily/monthly allowance, billing, or project quota). Retrying the
 * latter only delays the same failure and hides Google's useful explanation.
 */
export function isRetryableRateLimitError(error: unknown): boolean {
	if (!isRateLimitError(error)) return false;

	const message = formatError(error);
	return !(
		/current quota/i.test(message) ||
		/quota (?:has been )?exceeded/i.test(message) ||
		/quota failure/i.test(message) ||
		/plan and billing/i.test(message) ||
		/billing details/i.test(message) ||
		/(?:per day|daily|RPD|per month|monthly)/i.test(message)
	);
}

/**
 * @param apiPlan A host's plan name, when it has free and paid tiers with different rate-limit
 * advice. Hosts without tiers leave it out.
 */
export function buildErrorMessage(error: unknown, apiPlan?: string): string {
	if (isRateLimitError(error)) {
		if (apiPlan === "free") return t("chat.rateLimitFree");
		const message = formatError(error);
		// Preserve quota/billing details returned by the provider. A generic
		// "try another model until tomorrow" message is incorrect for monthly
		// search quotas, billing limits, and short-lived RPM/TPM limits alike.
		if (!isRetryableRateLimitError(error) && message) {
			return t("chat.errorOccurred", { message });
		}
		return t("chat.rateLimitPaid");
	}
	const message = error instanceof Error ? error.message : t("chat.unknownError");
	return t("chat.errorOccurred", { message });
}

// CLI session info with provider tracking
export interface CliSessionInfo {
	provider: ChatProvider;
	sessionId: string;
}

// Valid CLI providers that support session resumption
export const VALID_CLI_PROVIDERS: ChatProvider[] = ["antigravity-cli", "claude-cli", "codex-cli"];

export function isValidCliProvider(provider: string): provider is ChatProvider {
	return VALID_CLI_PROVIDERS.includes(provider as ChatProvider);
}

export interface ChatHistory {
	id: string;
	title: string;
	messages: Message[];
	createdAt: number;
	updatedAt: number;
	cliSession?: CliSessionInfo;  // CLI session for resumption (Claude CLI, etc.)
	isEncrypted?: boolean;  // Whether the chat is encrypted
}
