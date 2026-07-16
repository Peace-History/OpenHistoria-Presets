// Authentication helpers — extracted from the old index.ts so that
// ripPreset.ts and ripFeatures.ts can both call them.

import { BrowserContext, Page } from 'playwright';
import chalk from 'chalk';
import { PAX_HISTORIA_HOST, SESSION_COOKIE_NAME, TIMEOUTS } from './config.js';

/** True if the persistent profile already has a valid Pax session. */
export async function checkSignIn(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies(PAX_HISTORIA_HOST);
  return cookies.some((c) => c.name === SESSION_COOKIE_NAME);
}

/**
 * Open paxhistoria.co in a headed browser and poll the cookie jar until
 * a __session cookie appears. Throws on timeout.
 */
export async function waitForSignIn(page: Page): Promise<void> {
  console.log(
    chalk.yellow('\nPlease sign in to Pax Historia in the browser window.'),
  );
  console.log(chalk.yellow('Waiting for authentication...'));

  await page.goto(PAX_HISTORIA_HOST);

  const start = Date.now();
  const maxAttempts = Math.ceil(TIMEOUTS.signIn / 1000);

  for (let i = 0; i < maxAttempts; i++) {
    const cookies = await page.context().cookies(PAX_HISTORIA_HOST);
    if (cookies.some((c) => c.name === SESSION_COOKIE_NAME)) {
      console.log(
        chalk.green(
          `✓ Signed in successfully! (${((Date.now() - start) / 1000).toFixed(1)}s)`,
        ),
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error(
    `Timeout (${TIMEOUTS.signIn / 1000}s) waiting for ${SESSION_COOKIE_NAME} cookie on ${PAX_HISTORIA_HOST}`,
  );
}

/**
 * Decode the middle segment of a Firebase session JWT (the payload) without
 * verifying its signature. Sufficient for reading standard claims like
 * `user_id` / `sub`. Returns null on malformed input.
 *
 * SECURITY NOTE: this is NOT a verifier — a tampered cookie would decode
 * successfully. That's fine here: the only consumer is `===` against an
 * `authorUID` we just pulled from a publicly-readable Firestore doc. A
 * forged cookie that matches an existing author's UID would still need to
 * be created against Pax's Firebase project to be useful for anything
 * else; we have no escalation path to expose.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  // base64-decode requires 4-char alignment; pad if needed
  const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
  try {
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    const obj = JSON.parse(json);
    if (obj && typeof obj === 'object') return obj as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

/**
 * Read the signed-in user's Firebase UID from the `__session` cookie.
 * Returns null if the cookie is missing or the JWT payload has no
 * `user_id` / `sub` claim. Intended for ownership comparison against
 * `simplePresets/{id}.authorUID` (see `ensureCopyOfPreset`).
 */
export async function getSignedInUserUID(
  context: BrowserContext,
): Promise<string | null> {
  const cookies = await context.cookies(PAX_HISTORIA_HOST);
  const session = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
  if (!session || !session.value) return null;
  const payload = decodeJwtPayload(session.value);
  if (!payload) return null;
  const uid =
    (typeof payload.user_id === 'string' && payload.user_id) ||
    (typeof payload.sub === 'string' && payload.sub) ||
    null;
  return uid;
}
