import {friendlyPasskeyError} from './passkeyErrorCopy';

export const PASSKEY_INCOMPLETE_MESSAGE = 'Unlock was not completed. Your wallet remains locked.';
export const PASSKEY_FAILED_MESSAGE = 'Could not unlock with this passkey. Your wallet remains locked.';

/** WebAuthn NotAllowedError does not distinguish cancellation from timeout.
 * This is presentation only: no authentication, identity or session state changes. */
export function passkeyUnlockErrorMessage(error: unknown): string {
  const value = error !== null && typeof error === 'object' ? error as {name?: unknown;code?: unknown} : null;
  const name = typeof value?.name === 'string' ? value.name : '';
  const code = typeof value?.code === 'string' ? value.code : '';
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (['NotAllowedError', 'AbortError'].includes(name)
      || ['USER_CANCELLED', 'USER_CANCELED', 'ABORT_ERR'].includes(code)
      || /\b(?:NotAllowedError|AbortError)\b/.test(message)) return PASSKEY_INCOMPLETE_MESSAGE;
  return friendlyPasskeyError(error) ?? PASSKEY_FAILED_MESSAGE;
}
