// Pax Historia Asset Ripper — CLI entry point.
//
// Modes:
//   - Single preset:  bun run rip --preset <uid> [--force] [--no-features]
//   - From a URL file: bun run rip --from-file <path> [--force] [--limit N] [--no-features]
//   - Default (no args): if presets.txt exists at project root, read it.
//   - Legacy:         --presets | --geometry | --flags | --covers | --all
//                     (these still work via the old per-slice rippers)

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url';

import {
  DEFAULT_PRESETS_DIR,
  DEFAULT_PRESETS_FILE,
  INTER_PRESET_DELAY_MS,
  PAX_RIPPER_OUTPUT_DIR,
  PAX_BROWSE_URL,
  PAX_FLAGS_URL,
  SKIP_PRESETS,
} from './config.js';
import { CliArgs, RunSummary } from './types.js';
import { createBrowser } from './browser.js';
import { capturePreset, sleep } from './ripPreset.js';
import { writeRunSummary } from './manifest.js';
import { ripPresets } from './ripPresets.js';
import { ripGeometry } from './ripGeometry.js';
import { ripCovers } from './ripCovers.js';
import { ripFlags } from './ripFlags.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- CLI parsing ----------

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    presets: false,
    geometry: false,
    flags: false,
    covers: false,
    all: false,
    presetUid: null,
    fromFile: null,
    output: null,
    force: false,
    limit: null,
    noFeatures: false,
    featuresOnly: false,
    withEditor: false,
    noGame: false,
    reuseCopy: false,
    withGame: false,
    cookiesFile: null,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--presets':
        result.presets = true;
        break;
      case '--geometry':
        result.geometry = true;
        break;
      case '--flags':
        result.flags = true;
        break;
      case '--covers':
        result.covers = true;
        break;
      case '--all':
        result.all = true;
        break;
      case '--force':
        result.force = true;
        break;
      case '--no-features':
        result.noFeatures = true;
        break;
      case '--features-only':
        result.featuresOnly = true;
        break;
      case '--with-editor':
        result.withEditor = true;
        break;
      case '--no-game':
        result.noGame = true;
        break;
      case '--with-game':
        result.withGame = true;
        break;
      case '--reuse-copy':
        result.reuseCopy = true;
        break;
      case '--cookies':
        if (i + 1 < args.length) result.cookiesFile = args[++i];
        break;
      case '--preset':
        if (i + 1 < args.length) result.presetUid = args[++i];
        break;
      case '--from-file':
        if (i + 1 < args.length) result.fromFile = args[++i];
        break;
      case '--output':
        if (i + 1 < args.length) result.output = args[++i];
        break;
      case '--limit':
        if (i + 1 < args.length) result.limit = Number(args[++i]) || null;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(chalk.yellow(`Unknown flag: ${a}`));
        break;
    }
  }

  return result;
}

function printHelp(): void {
  console.log(chalk.cyan('Pax Historia Asset Ripper\n'));
  console.log('Usage:');
  console.log('  bun run rip --preset <uid>                 Capture a single preset');
  console.log('  bun run rip --preset <uid> --with-editor   Also scrape the editor view. When');
  console.log('                                             successful, features.json is DERIVED');
  console.log('                                             from the editor data (Play Now is');
  console.log('                                             skipped). For non-owned presets, the');
  console.log('                                             ripper copies the preset first.');
  console.log('  bun run rip --preset <uid> --with-game     Force BOTH editor and Play Now flows');
  console.log('  bun run rip --preset <uid> --no-game       Skip Play Now even if editor fails');
  console.log('  bun run rip --preset <uid> --reuse-copy    Reuse a prior copy (from manifest)');
  console.log('                                             instead of creating a fresh one');
  console.log('  bun run rip --from-file <path>            Capture every URL in <path>');
  console.log('  bun run rip --from-file <path> --limit N  Capture only the first N');
  console.log('  bun run rip --no-features                 Skip map-features capture');
  console.log('  bun run rip --features-only               Re-run features step only');
  console.log('  bun run rip --force                       Overwrite existing manifest');
  console.log('  bun run rip --output <dir>                Override output base dir');
  console.log('  bun run rip --cookies <path>              Cookies file for editor auth (HttpOnly OK)');
  console.log('');
  console.log('Legacy per-slice modes:');
  console.log('  bun run rip --presets   Discover preset UIDs via /api/presets/search');
  console.log('  bun run rip --geometry  Rip geometry for discovered UIDs');
  console.log('  bun run rip --covers    Rip cover/landing images for UIDs');
  console.log('  bun run rip --flags     Rip flag images');
  console.log('  bun run rip --all       Rip everything via the legacy pipeline');
  console.log('');
  console.log('Defaults:');
  console.log(`  URL file:    ${DEFAULT_PRESETS_FILE}`);
  console.log(`  Output dir:  ${DEFAULT_PRESETS_DIR}`);
  console.log(`  Skip list:   ${SKIP_PRESETS.size} presets`);
}

// ---------- URL list parsing ----------

interface UrlList {
  paxIDs: string[];
  source: string;
  skipped: string[];
}

function readUrlList(file: string): UrlList {
  const raw = fs.readFileSync(file, 'utf-8');
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  const paxIDs: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    let id: string | null = null;
    if (/^https?:\/\//.test(line)) {
      try {
        const u = new URL(line);
        const segs = u.pathname.split('/').filter(Boolean);
        if (segs.length > 0) id = segs[segs.length - 1];
      } catch {
        // fall through
      }
    } else if (/^[A-Za-z0-9_-]+$/.test(line)) {
      id = line;
    }
    if (!id) {
      console.warn(chalk.yellow(`Skipping malformed line: ${line}`));
      continue;
    }
    if (SKIP_PRESETS.has(id)) {
      skipped.push(id);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    paxIDs.push(id);
  }
  return { paxIDs, source: file, skipped };
}

// ---------- main ----------

async function main(): Promise<void> {
  const args = parseArgs();

  // ----- Default behavior: no slice flags + no preset/file = read presets.txt
  const noSliceFlags =
    !args.presets &&
    !args.geometry &&
    !args.flags &&
    !args.covers &&
    !args.all &&
    !args.presetUid;
  let effectiveFromFile = args.fromFile;
  if (noSliceFlags && !args.presetUid) {
    if (fs.existsSync(DEFAULT_PRESETS_FILE)) {
      effectiveFromFile = DEFAULT_PRESETS_FILE;
      console.log(
        chalk.gray(
          `No flags given — defaulting to --from-file ${DEFAULT_PRESETS_FILE}`,
        ),
      );
    } else {
      printHelp();
      return;
    }
  }

  console.log(chalk.cyan('═══════════════════════════════════════════'));
  console.log(chalk.cyan('  Pax Historia Asset Ripper'));
  console.log(chalk.cyan('═══════════════════════════════════════════\n'));

  const browser = await createBrowser();
  try {
    await browser.ensureSignedIn();
    const page = await browser.getPage();

    // ----- Legacy slice modes
    if (args.presets || args.geometry || args.covers || args.flags || args.all) {
      await runLegacySlices(page, args);
      return;
    }

    // ----- Single preset mode
    if (args.presetUid) {
      const outBase = args.output ?? DEFAULT_PRESETS_DIR;
      const includeFeatures = !args.noFeatures;
      const result = await capturePreset(page, {
        paxID: args.presetUid,
        outputBaseDir: outBase,
        force: args.force,
        includeFeatures,
        withEditor: args.withEditor,
        noGame: args.noGame,
        withGame: args.withGame,
        reuseCopy: args.reuseCopy,
        cookiesFile: args.cookiesFile ?? undefined,
      });
      console.log(chalk.green(`\nDone. status=${result.status}`));
      return;
    }

    // ----- From-file batch mode
    if (effectiveFromFile) {
      const outBase = args.output ?? DEFAULT_PRESETS_DIR;
      const list = readUrlList(effectiveFromFile);
      let paxIDs = list.paxIDs;
      if (args.limit != null) paxIDs = paxIDs.slice(0, args.limit);
      console.log(
        chalk.blue(
          `\nCapturing ${paxIDs.length} presets from ${list.source} (skipped ${list.skipped.length})\n`,
        ),
      );
      const summary = await runBatch(page, paxIDs, outBase, args);
      writeRunSummary(outBase, summary);
      console.log(
        chalk.green(
          `\n═══════════════════════════════════════════\n  Done.\n` +
            `  captured:  ${summary.captured}\n` +
            `  skipped:   ${summary.skipped}\n` +
            `  failed:    ${summary.failed}\n` +
            `  features ✓: ${summary.featuresSucceeded}\n` +
            `  features ✗: ${summary.featuresFailed}\n` +
            `  summary:   ${path.join(outBase, '_run_summary.json')}\n` +
            `═══════════════════════════════════════════`,
        ),
      );
      return;
    }

    printHelp();
  } catch (error) {
    console.error(chalk.red('\nError:'), error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// ---------- batch runner ----------

async function runBatch(
  page: import('playwright').Page,
  paxIDs: string[],
  outBase: string,
  args: CliArgs,
): Promise<RunSummary> {
  const includeFeatures = !args.noFeatures;
  const summary: RunSummary = {
    runAt: new Date().toISOString(),
    total: paxIDs.length,
    captured: 0,
    skipped: 0,
    failed: 0,
    featuresSucceeded: 0,
    featuresFailed: 0,
    failures: [],
  };

  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 5;
  let currentPage = page;
  let browser: import('./browser.js').BrowserHandle | null = null;

  for (let i = 0; i < paxIDs.length; i++) {
    const paxID = paxIDs[i];
    const label = `[${i + 1}/${paxIDs.length}]`;
    console.log(chalk.blue(`\n${label} ${paxID}`));

    // Check if browser/page is still alive
    try {
      if (currentPage.isClosed()) {
        throw new Error('page is closed');
      }
      // Quick health check
      await currentPage.url();
    } catch {
      console.log(chalk.yellow(`  ${label} browser page closed — restarting browser...`));
      try {
        if (browser) await browser.close().catch(() => {});
        browser = await createBrowser();
        await browser.ensureSignedIn();
        currentPage = await browser.getPage();
        console.log(chalk.green(`  ${label} browser restarted`));
      } catch (restartErr) {
        console.error(chalk.red(`  ${label} could not restart browser: ${restartErr}`));
        summary.failed++;
        consecutiveFailures++;
        summary.failures.push({
          paxID,
          reason: `browser_restart_failed: ${restartErr instanceof Error ? restartErr.message : String(restartErr)}`,
        });
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) break;
        continue;
      }
    }

    try {
      const r = await capturePreset(currentPage, {
        paxID,
        outputBaseDir: outBase,
        force: args.force,
        includeFeatures,
        withEditor: args.withEditor,
        noGame: args.noGame,
        withGame: args.withGame,
        reuseCopy: args.reuseCopy,
        cookiesFile: args.cookiesFile ?? undefined,
      });
      switch (r.status) {
        case 'captured':
          summary.captured++;
          consecutiveFailures = 0;
          if (r.manifest?.featuresStatus?.success) summary.featuresSucceeded++;
          else if (r.manifest?.featuresStatus?.attempted) summary.featuresFailed++;
          break;
        case 'skipped':
          summary.skipped++;
          consecutiveFailures = 0;
          break;
        default:
          summary.failed++;
          consecutiveFailures++;
          summary.failures.push({
            paxID,
            reason: `${r.status}: ${r.error ?? 'unknown'}`,
          });
      }
    } catch (e) {
      summary.failed++;
      consecutiveFailures++;
      summary.failures.push({
        paxID,
        reason: e instanceof Error ? e.message : String(e),
      });
      console.error(chalk.red(`  ${label} failed: ${e}`));

      // Recovery: try to reset browser state
      try {
        console.log(chalk.gray(`  ${label} recovering browser state...`));
        if (!currentPage.isClosed()) {
          await currentPage.goto('about:blank', { timeout: 5_000 }).catch(() => {});
        }
      } catch {
        // ignore recovery errors — page may already be closed
      }
    }

    // If too many consecutive failures, the browser session is likely broken
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.error(
        chalk.red(
          `\n${MAX_CONSECUTIVE_FAILURES} consecutive failures — stopping batch.\n` +
          `Last failures:\n` +
          summary.failures.slice(-MAX_CONSECUTIVE_FAILURES).map(f => `  ${f.paxID}: ${f.reason}`).join('\n'),
        ),
      );
      break;
    }

    if (i < paxIDs.length - 1) {
      await sleep(INTER_PRESET_DELAY_MS);
    }
  }

  // Clean up browser if we created one
  if (browser) {
    await browser.close().catch(() => {});
  }

  return summary;
}

// ---------- legacy slice dispatcher ----------

async function runLegacySlices(
  page: import('playwright').Page,
  args: CliArgs,
): Promise<void> {
  const presetUids: string[] = [];
  if (args.presets || args.all) {
    console.log(chalk.blue('\n📋 Ripping presets...'));
    const ids = await ripPresets(page, PAX_RIPPER_OUTPUT_DIR);
    presetUids.push(...ids);
    console.log(chalk.green(`✓ Found ${ids.length} presets`));
  }
  if (args.geometry || args.all) {
    console.log(chalk.blue('\n🗺️  Ripping geometry...'));
    await ripGeometry(
      page,
      PAX_RIPPER_OUTPUT_DIR,
      args.presetUid ? [args.presetUid] : presetUids,
    );
  }
  if (args.flags || args.all) {
    console.log(chalk.blue('\n🏴 Ripping flags...'));
    await ripFlags(page, PAX_RIPPER_OUTPUT_DIR);
  }
  if (args.covers || args.all) {
    console.log(chalk.blue('\n🖼️  Ripping covers...'));
    await ripCovers(
      page,
      PAX_RIPPER_OUTPUT_DIR,
      args.presetUid ? [args.presetUid] : presetUids,
    );
  }
  console.log(
    chalk.green(
      `\n═══════════════════════════════════════════\n  Done. Output: ${PAX_RIPPER_OUTPUT_DIR}\n═══════════════════════════════════════════\n`,
    ),
  );
}

// Reserved for future flags / debugging.
void PAX_BROWSE_URL;
void PAX_FLAGS_URL;
void __dirname;

main().catch((e) => {
  console.error(chalk.red('Fatal:'), e);
  process.exit(1);
});
