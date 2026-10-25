export type LookupFailure = 'syntax' | 'notFound' | 'timeout' | 'unavailable';
/** Only authoritative machine codes establish an unknown recipient. Network failures do not. */
export function classifyLookupFailure(error: unknown): LookupFailure {
 const x=error as {code?:unknown;name?:unknown}; const code=String(x?.code??'').toUpperCase();
 if(['INVALID_LIGHTNING_ADDRESS','INVALID_ADDRESS_SYNTAX'].includes(code))return 'syntax';
 if(['LIGHTNING_ADDRESS_NOT_FOUND','RECIPIENT_NOT_FOUND'].includes(code))return 'notFound';
 if(['TIMEOUT','ETIMEDOUT','DEADLINE_EXCEEDED'].includes(code)||x?.name==='TimeoutError'||x?.name==='AbortError')return 'timeout';
 return 'unavailable';
}
