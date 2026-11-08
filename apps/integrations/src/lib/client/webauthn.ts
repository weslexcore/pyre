// The browser half of a passkey ceremony. The server asks Supabase for the
// options and verifies the result (api/auth/passkey/*, for sign-in, and
// api/auth/account/passkey/*, for adding one), so all the browser does here
// is call navigator.credentials. The JSON conversions are the browser's own
// (parse*OptionsFromJSON, credential.toJSON), and passkeys are simply not
// offered where those are missing. Client-bundle-safe.

import { sendJson } from './api';

interface PublicKeyCredentialStatics {
  parseRequestOptionsFromJSON?: (json: unknown) => PublicKeyCredentialRequestOptions;
  parseCreationOptionsFromJSON?: (json: unknown) => PublicKeyCredentialCreationOptions;
}

function statics(): PublicKeyCredentialStatics | null {
  if (typeof window === 'undefined' || !('PublicKeyCredential' in window)) return null;
  return window.PublicKeyCredential as unknown as PublicKeyCredentialStatics;
}

/** Whether this browser can do a passkey ceremony from JSON options. */
export function passkeysSupported(): boolean {
  const pkc = statics();
  return (
    !!pkc &&
    typeof pkc.parseRequestOptionsFromJSON === 'function' &&
    typeof pkc.parseCreationOptionsFromJSON === 'function' &&
    !!navigator.credentials
  );
}

/** The person closed the prompt or it timed out: not worth an error message. */
export class PasskeyCancelled extends Error {
  constructor() {
    super('Passkey prompt closed');
    this.name = 'PasskeyCancelled';
  }
}

interface Challenge {
  challengeId: string;
  options: unknown;
}

function toJson(credential: Credential | null): unknown {
  if (!credential) throw new PasskeyCancelled();
  return (credential as PublicKeyCredential).toJSON();
}

function rethrow(error: unknown): never {
  if (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  ) {
    throw new PasskeyCancelled();
  }
  throw error;
}

/** Sign in with a passkey; resolves to where the server says to go next. */
export async function signInWithPasskey(returnUrl: string): Promise<string> {
  const pkc = statics();
  if (!pkc?.parseRequestOptionsFromJSON) throw new Error('This browser does not support passkeys.');

  const challenge = await sendJson<Challenge>('/api/auth/passkey/options', 'POST', { returnUrl });
  let credential: unknown;
  try {
    credential = toJson(
      await navigator.credentials.get({
        publicKey: pkc.parseRequestOptionsFromJSON(challenge.options),
      })
    );
  } catch (error) {
    rethrow(error);
  }
  const { redirectTo } = await sendJson<{ redirectTo: string }>(
    '/api/auth/passkey/verify',
    'POST',
    {
      challengeId: challenge.challengeId,
      credential,
    }
  );
  return redirectTo;
}

/** Add a passkey for the signed-in person. */
export async function registerPasskey(): Promise<void> {
  const pkc = statics();
  if (!pkc?.parseCreationOptionsFromJSON)
    throw new Error('This browser does not support passkeys.');

  const challenge = await sendJson<Challenge>('/api/auth/account/passkey/options', 'POST', {});
  let credential: unknown;
  try {
    credential = toJson(
      await navigator.credentials.create({
        publicKey: pkc.parseCreationOptionsFromJSON(challenge.options),
      })
    );
  } catch (error) {
    rethrow(error);
  }
  await sendJson('/api/auth/account/passkey/verify', 'POST', {
    challengeId: challenge.challengeId,
    credential,
  });
}
