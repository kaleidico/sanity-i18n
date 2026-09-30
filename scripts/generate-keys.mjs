#!/usr/bin/env node
/**
 * Generates the key pair a site uses to store its Anthropic API key.
 *
 *   npx sanity-i18n-generate-keys
 *
 * Prints two lines for the site's environment:
 *
 *   NEXT_PUBLIC_I18N_PUBLIC_KEY   the public key (SPKI, base64). Safe in the
 *                                 browser: it can only encrypt.
 *   I18N_PRIVATE_KEY              the private key (PKCS8, base64). Server
 *                                 only. Anyone who has it can read the saved
 *                                 API key, so treat it like a password.
 *
 * Add both to `.env.local` and to the hosting environment, then redeploy.
 * RSA-OAEP, 4096 bits, SHA-256. Run it once per site; a new pair means the
 * API key has to be entered again in Site Settings.
 */
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 4096,
  publicKeyEncoding: { type: "spki", format: "der" },
  privateKeyEncoding: { type: "pkcs8", format: "der" },
});

process.stdout.write(`NEXT_PUBLIC_I18N_PUBLIC_KEY=${publicKey.toString("base64")}\n`);
process.stdout.write(`I18N_PRIVATE_KEY=${privateKey.toString("base64")}\n`);
