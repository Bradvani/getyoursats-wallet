export function isProviderWebhookId(value: unknown): value is string;
export function pushOperationPayload(action: string, extra: Record<string, unknown>): string;
export function pushAuthorizationMessage(action: string, pub: string, nonce: string, payloadHash: string): string;
