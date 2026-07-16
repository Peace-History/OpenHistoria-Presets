// Browser factory — launches a persistent Chromium context so the
// user's Pax Historia session is reused across runs.
//
// Resilience:
//   - Detects the "profile is already in use" error (stale SingletonLock
//     from a crashed/closed Chromium) and retries once after clearing the
//     lock files. If the retry fails, gives a clear actionable message.
//   - Surfaces "context closed" errors during sign-in with a hint about
//     closing the browser window manually.

import { chromium, BrowserContext, Page } from 'playwright';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { BROWSER_PROFILE_DIR } from './config.js';
import { checkSignIn, waitForSignIn } from './auth.js';

export interface BrowserHandle {
  context: BrowserContext;
  /** A ready-to-use page (the first one in the context, or a new tab). */
  getPage: () => Promise<Page>;
  /** Ensure the user is signed in, opening a headed window if not. */
  ensureSignedIn: () => Promise<void>;
  close: () => Promise<void>;
}

const LOCK_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

function clearStaleLocks(profileDir: string): void {
  for (const name of LOCK_FILES) {
    const p = path.join(profileDir, name);
    try {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        console.log(chalk.gray(`  removed stale lock: ${name}`));
      }
    } catch {
      // best-effort
    }
  }
}

async function launchPersistentWithRetry(): Promise<BrowserContext> {
  try {
    return await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isProfileBusy =
      msg.includes('Opening in existing browser session') ||
      msg.includes('already in use') ||
      msg.includes('singleton') ||
      msg.toLowerCase().includes('another instance');

    if (!isProfileBusy) throw e;

    console.log(
      chalk.yellow(
        '\n⚠ Persistent profile is locked by another Chromium instance.',
      ),
    );
    console.log(
      chalk.yellow(
        '  Clearing stale lock files and retrying once...\n',
      ),
    );
    clearStaleLocks(BROWSER_PROFILE_DIR);

    try {
      return await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
        headless: false,
        viewport: { width: 1280, height: 800 },
        args: ['--disable-blink-features=AutomationControlled'],
      });
    } catch (e2) {
      const m2 = e2 instanceof Error ? e2.message : String(e2);
      console.error(
        chalk.red(
          `\n✗ Could not launch Chromium with profile ${BROWSER_PROFILE_DIR}\n` +
            `  Reason: ${m2}\n\n` +
            `  Fix options:\n` +
            `    1. Close any other Chromium window using this profile.\n` +
            `    2. Run:  pkill -f 'pax-ripper|browser-profile'\n` +
            `    3. Manually delete lock files:  rm -f ${BROWSER_PROFILE_DIR}/{SingletonLock,SingletonSocket,SingletonCookie}\n` +
            `    4. Pass --no-persistent to use a throwaway profile (you'll need to sign in again).`,
        ),
      );
      throw e2;
    }
  }
}

export async function createBrowser(): Promise<BrowserHandle> {
  console.log(chalk.gray(`Using browser profile: ${BROWSER_PROFILE_DIR}\n`));

  const context = await launchPersistentWithRetry();

  const getPage = async (): Promise<Page> => {
    if (context.pages().length === 0) {
      return await context.newPage();
    }
    return context.pages()[0];
  };

  const ensureSignedIn = async (): Promise<void> => {
    let signedIn = false;
    try {
      signedIn = await checkSignIn(context);
    } catch (e) {
      // Context was closed underneath us; re-throw with a hint.
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Browser context was closed before sign-in check could run: ${msg}\n` +
          `  (If the Chromium window closed on its own, re-run the command.)`,
      );
    }
    if (signedIn) {
      console.log(chalk.green('✓ Already signed in'));
      return;
    }
    const page = await getPage();
    await waitForSignIn(page);
  };

  const close = async (): Promise<void> => {
    try {
      await context.close();
    } catch {
      // already closed
    }
  };

  return { context, getPage, ensureSignedIn, close };
}
