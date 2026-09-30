/**
 * Reading the site's API key on the server. The Studio encrypts it with the
 * site's public key (see `encryptSecret`); only the private key, which lives
 * in the server's environment and nowhere else, can read it back. The
 * plaintext is returned to the caller, used for the request and dropped. It
 * is never stored, returned to a browser or written to a log.
 */
import { base64ToBytes, publicKeyFingerprint, SECRETS_ID, type StoredSecret } from "../core/engineModel";
import { EngineError } from "./errors";
import type { SanityLike } from "./sanityHttp";

/** Read a secret that was encrypted with the matching public key (RSA-OAEP, SHA-256; PKCS8 private key, base64). */
export async function decryptSecret(privateKey: string, ciphertext: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(privateKey) as BufferSource,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
  const plain = await globalThis.crypto.subtle.decrypt({ name: "RSA-OAEP" }, key, base64ToBytes(ciphertext) as BufferSource);
  return new TextDecoder().decode(plain);
}

export interface LoadApiKeyOptions {
  /** The private key (PKCS8, base64). Defaults to the `I18N_PRIVATE_KEY` environment variable. */
  privateKey?: string;
  /** The public key (SPKI, base64), used only to say so when the saved key belongs to another key pair. */
  publicKey?: string;
}

/**
 * The site's API key, read from the private `i18n.secrets` document and
 * decrypted. Throws an EngineError in plain words when key storage is not set
 * up, no key was saved, or the saved key cannot be read with this server's
 * private key.
 */
export async function loadApiKey(sanity: SanityLike, options: LoadApiKeyOptions = {}): Promise<string> {
  const privateKey = options.privateKey ?? process.env.I18N_PRIVATE_KEY ?? "";
  if (privateKey.trim() === "") throw new EngineError("key_storage_not_configured");

  const document = await sanity.getDocument(SECRETS_ID);
  const stored = (document?.anthropicKey ?? null) as Partial<StoredSecret> | null;
  if (!stored || typeof stored.ciphertext !== "string" || stored.ciphertext === "") throw new EngineError("missing_key");

  const publicKey = options.publicKey ?? process.env.NEXT_PUBLIC_I18N_PUBLIC_KEY ?? "";
  if (publicKey && stored.keyFingerprint) {
    let fingerprint = "";
    try {
      fingerprint = await publicKeyFingerprint(publicKey);
    } catch {
      fingerprint = "";
    }
    if (fingerprint && fingerprint !== stored.keyFingerprint) throw new EngineError("key_unreadable");
  }

  let plain = "";
  try {
    plain = await decryptSecret(privateKey, stored.ciphertext);
  } catch {
    throw new EngineError("key_unreadable");
  }
  if (plain.trim() === "") throw new EngineError("missing_key");
  return plain.trim();
}
