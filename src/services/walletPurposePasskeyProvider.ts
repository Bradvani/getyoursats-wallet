import {PasskeyProvider} from '@breeztech/breez-sdk-spark/passkey-prf-provider';
import {isLinkedUserHandle} from '../security/linkedPasskeyProtocol';

/** The pinned SDK routes all browser PRF assertions through this method.
 * Reject a vault-protection credential BEFORE the SDK derives another seed or
 * publishes labels. Fresh profiles can recognize the purpose from userHandle.
 * No SDK bytes are patched. Tests bind this adapter to the installed provider. */
export class WalletPurposePasskeyProvider extends PasskeyProvider {
  async _performAssertion(prfEval: unknown, options: unknown): Promise<PublicKeyCredential> {
    const implementation: unknown = Reflect.get(PasskeyProvider.prototype, '_performAssertion');
    if (typeof implementation !== 'function') throw new Error('Passkey provider compatibility could not be verified.');
    const credential = await Reflect.apply(implementation, this, [prfEval, options]) as PublicKeyCredential;
    const response = credential.response as AuthenticatorAssertionResponse;
    if (isLinkedUserHandle(response.userHandle)) {
      throw new Error('This passkey protects an imported wallet. Use its encrypted recovery file or original recovery words, not new-wallet sign-in.');
    }
    return credential;
  }
}
