#!/usr/bin/env bun
// dump-all.ts - Bulk Pax -> Open-Historia export + hub conformance check.
//
// Iterates `IDs` at the repo root, captures each UID via pax-ripper's
// single-UID --preset path, transforms it through the existing offline
// pipeline (loadCaptureFromDir -> transform -> writeBundle), then runs
// diffAgainstHubBundles against the 6 official hub bundles. Prints one
// PASS / FAIL / SKIP row per UID plus a final summary.
//
// Flags:
//   --limit N        Process at most N UIDs from IDs (default: all)
//   --resume         Skip UIDs whose out/<uid>.json already exists + parses
//                    AND whose capture cache has a non-empty preset.json
//   --force          Bypass the resume checks (always re-capture + re-export)
//   --ids <path>     Read IDs from <path> (default: ./IDs)
//   --output <dir>   Bundle output dir (default: ./out)
//   --cache <dir>    pax-ripper cache dir (default: ./out/cache)
//   --hub <dir>      Hub bundles dir (default: /home/john/Projects/Open-historia-scenarios/bundles)
//   --help           Show this help
//
// Exit codes:
//   0 = at least one UID processed, all PASS
//   1 = at least one FAIL
//   2 = no UIDs processed (input empty after filter, or every UID errored before any work began)
//   3 = --resume and every UID was skipped (nothing to do)
//
// Auth prerequisite:
//   Requires the persistent browser profile at ~/.config/pax-ripper/browser-profile/
//   (the same profile pax-ripper's CLI uses for sign-in). Run `bun run rip --presets`
//   once to bootstrap. The script checks for this upfront and exits 1 with a clear
//   message if it's missing.

import { existsSync, statSync, readFileSync } from "node:fs";
import { readFile, mkdir } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { spawn } from "bun";
import { BROWSER_PROFILE_DIR, INTER_PRESET_DELAY_MS } from "../../pax-ripper/src/config";
import { loadCaptureFromDir, pickLatestVersionDir, latestCaptureDirLooksComplete } from "../src/capture";
import { transform } from "../src/transform";
import { writeBundle } from "../src/bundle";
import { diffAgainstHubBundles, loadHubBundles } from "../src/conformance";

const ROOT = new URL("../../..", import.meta.url).pathname;

export type FilterResult = { uids: string[]; skipped: string[] };

/** Filter raw `IDs` content to Pax-UID-shaped lines. Exported for testing. */
export function filterUids(raw: string): FilterResult {
  const lines = raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
  const uids: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();
  const re = /^[A-Za-z0-9]{16,}$/;
  for (const line of lines) {
    if (!re.test(line)) {
      skipped.push(line);
      continue;
    }
    if (seen.has(line)) continue;
    seen.add(line);
    uids.push(line);
  }
  return { uids, skipped };
}

type Args = {
  help: boolean;
  limit?: number;
  resume: boolean;
  force: boolean;
  idsPath: string;
  outputDir: string;
  cacheDir: string;
  hubDir: string;
};

export function parseArgs(argv: string[]): Args {
  const out: Args = {
    help: false,
    resume: false,
    force: false,
    idsPath: join(ROOT, "IDs"),
    outputDir: join(ROOT, "out"),
    cacheDir: join(ROOT, "out", "cache"),
    hubDir: process.env.HUB_BUNDLES_DIR ?? "/home/john/Projects/Open-historia-scenarios/bundles",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => argv[++i];
    switch (a) {
      case "--help":
      case "-h": out.help = true; break;
      case "--limit": {
        const n = Number(take());
        if (!Number.isInteger(n) || n <= 0) throw new Error(`--limit must be a positive integer (got ${take()})`);
        out.limit = n;
        break;
      }
      case "--resume": out.resume = true; break;
      case "--force": out.force = true; break;
      case "--ids": out.idsPath = resolve(take()); break;
      case "--output": out.outputDir = resolve(take()); break;
      case "--cache": out.cacheDir = resolve(take()); break;
      case "--hub": out.hubDir = resolve(take()); break;
      default: throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

function printHelp(): void {
  const text = [
    "Usage: bun run dump-all [--limit N] [--resume] [--force] [--ids <path>] [--output <dir>]",
    "",
    "Bulk-export every UID in IDs to out/<uid>.json and run the hub-conformance check.",
    "Reuses pax-ripper's single-UID capture + the offline transform pipeline.",
    "",
    "Flags:",
    "  --limit N        Process at most N UIDs (default: all)",
    "  --resume         Skip UIDs whose out/<uid>.json already passes conformance",
    "  --force          Bypass the resume checks (always re-capture + re-export)",
    "  --ids <path>     Read IDs from <path> (default: ./IDs)",
    "  --output <dir>   Bundle output dir (default: ./out)",
    "  --cache <dir>    pax-ripper cache dir (default: ./out/cache)",
    "  --hub <dir>      Hub bundles dir (default: /home/john/Projects/Open-historia-scenarios/bundles)",
    "  --help           Show this help",
    "",
    "Exit codes:",
    "  0 = at least one UID processed, all PASS",
    "  1 = at least one FAIL",
    "  2 = no UIDs processed at all",
    "  3 = --resume and every UID was skipped (nothing to do)",
    "",
    "Auth prerequisite: ~/.config/pax-ripper/browser-profile/ must exist",
    "(bootstrap with `bun run rip --presets`).",
  ].join("\n");
  console.log(text);
}

/** Returns true if `out/<uid>.json` exists, is > 1 KB, and parses as JSON. */
async function bundleAlreadyExported(outPath: string): Promise<boolean> {
  if (!existsSync(outPath)) return false;
  let size: number;
  try {
    size = statSync(outPath).size;
  } catch {
    return false;
  }
  if (size <= 1024) return false;
  try {
    JSON.parse(await readFile(outPath, "utf8"));
    return true;
  } catch {
    return false;
  }
}

/** Wrapper used by tests + the resume gate. Returns true iff the latest
 *  capture version dir under `cacheDir` has manifest.json AND a non-empty
 *  preset.json AND geometry.json -- i.e. loadCaptureFromDir won't fail on a
 *  half-written capture. Delegates to capture.ts so the sort algorithm lives
 *  in one place. */
export function captureCacheLooksComplete(cacheDir: string): boolean {
  return latestCaptureDirLooksComplete(cacheDir) !== undefined;
}

/** Read manifest.incomplete from the latest version dir (if present) so the
 *  orchestrator can surface a specific reason in its FAIL row instead of the
 *  generic "geometry.json missing" message from loadCaptureFromDir. Returns
 *  undefined when manifest.json is missing or has no incomplete field. */
export function captureIncompleteReason(versionDir: string): string | undefined {
  const manifestPath = join(versionDir, "manifest.json");
  if (!existsSync(manifestPath)) return undefined;
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (typeof manifest.incomplete === "string" && manifest.incomplete.length > 0) {
    return manifest.incomplete;
  }
  return undefined;
}

/** Decide what status to surface when the capture sub-process exits non-zero.
 *  Reads manifest.incomplete to distinguish transients (SKIP — operator can
 *  retry later) from real failures (null — let the caller write a generic
 *  FAIL row with the exit code).
 *
 *  Currently handles: `copy_protected:Nd` — Pax-side temporary copy-protection
 *  window set by the preset author. The capture sub-process exits 2 with this
 *  reason in the manifest; dump-all should SKIP and let the operator know when
 *  to retry (N days from now). */
export function classifyIncompleteReason(
  reason: string | undefined,
): { status: "SKIP"; detail: string } | null {
  if (!reason) return null;
  if (reason.startsWith("copy_protected:")) {
    const days = reason.split(":")[1] ?? "?";
    return { status: "SKIP", detail: `copy_protected (${days})` };
  }
  return null;
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

// Build the per-UID pax-ripper invocation. Exported so the test can assert
// --with-editor is forwarded (without it pax-ripper skips the editor flow,
// geometry.json is never downloaded, and the transform's loadCaptureFromDir
// throws "geometry.json missing").
export function buildCaptureCmd(uid: string, cacheDir: string, force: boolean): string[] {
  const cmd = ["bun", "run", join(ROOT, "tools/pax-ripper/src/index.ts"), "--preset", uid, "--with-editor", "--output", cacheDir];
  if (force) cmd.push("--force");
  return cmd;
}

async function captureOne(uid: string, cacheDir: string, force: boolean): Promise<number> {
  const cmd = buildCaptureCmd(uid, cacheDir, force);
  const proc = spawn({
    cmd,
    stdio: ["inherit", "inherit", "inherit"],
  });
  return proc.exited;
}

type Row = { uid: string; status: "PASS" | "FAIL" | "SKIP"; detail: string; elapsedMs: number };

async function processUid(
  uid: string,
  args: Args,
  hubBundles: Awaited<ReturnType<typeof loadHubBundles>>,
): Promise<Row> {
  const started = Date.now();
  const outPath = join(args.outputDir, `${uid}.json`);
  const cacheDir = join(args.cacheDir, uid);

  // Resume check (skip capture + transform + check if bundle already valid).
  if (args.resume && !args.force && (await bundleAlreadyExported(outPath))) {
    return { uid, status: "SKIP", detail: "already exported", elapsedMs: Date.now() - started };
  }

  // Capture step (or reuse cache). --force re-captures even when the cache
// looks complete; without --force we trust the existing capture on --resume.
  if (args.force || !args.resume || !captureCacheLooksComplete(cacheDir)) {
    const code = await captureOne(uid, args.cacheDir, args.force);
    if (code !== 0) {
      return { uid, status: "FAIL", detail: `capture exited ${code}`, elapsedMs: Date.now() - started };
    }
  }

  // Find the latest version dir under cache.
  const versionDir = await pickLatestVersionDir(cacheDir);
  if (!versionDir) {
    return { uid, status: "FAIL", detail: "no capture version dir under cache", elapsedMs: Date.now() - started };
  }
  const version = basename(versionDir);

  // Transform + write bundle.
  let bundleAndAssets;
  const transformStart = Date.now();
  try {
    const capture = await loadCaptureFromDir(versionDir);
    bundleAndAssets = transform(capture, { mode: "full" });
  } catch (err) {
    const msg = (err as Error).message;
    const reason = captureIncompleteReason(versionDir);
    const detail = reason ? `incomplete: ${reason}` : `transform: ${msg}`;
    return { uid, status: "FAIL", detail, elapsedMs: Date.now() - started };
  }

  try {
    await writeBundle(bundleAndAssets, { outputPath: outPath, paxID: uid, version, mode: "full", transformDurationMs: Date.now() - transformStart });
  } catch (err) {
    return { uid, status: "FAIL", detail: `write: ${(err as Error).message}`, elapsedMs: Date.now() - started };
  }

  // Conformance check. Re-read the just-written bundle so conformance sees
// the on-disk shape (where `assets` lives at the top level), not the
// in-memory shape (where `bundleAndAssets.bundle` is ScenarioBundle without
// assets -- assets are in the sibling `assets` field).
  const onDisk = JSON.parse(await readFile(outPath, "utf8")) as Record<string, unknown>;
  const report = diffAgainstHubBundles(onDisk, hubBundles);
  if (!report.pass) {
    const fails = report.results.filter((r) => !r.pass).map((r) => r.check).join(", ");
    return { uid, status: "FAIL", detail: `conformance: ${fails}`, elapsedMs: Date.now() - started };
  }

  return { uid, status: "PASS", detail: "", elapsedMs: Date.now() - started };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return 0;
  }

  // Auth pre-flight (run first so a fresh-checkout operator sees the actionable
  // error before any other failures).
  if (!existsSync(BROWSER_PROFILE_DIR)) {
    console.error(`error: missing browser profile at ${BROWSER_PROFILE_DIR}`);
    console.error(`  bootstrap with: bun run rip --presets  (one-time, opens a browser for sign-in)`);
    return 1;
  }

  // Read + filter IDs.
  if (!existsSync(args.idsPath)) {
    console.error(`error: IDs file not found at ${args.idsPath}`);
    return 2;
  }
  const idsRaw = await readFile(args.idsPath, "utf8");
  const { uids: allUids, skipped } = filterUids(idsRaw);
  console.log(`filtered ${allUids.length} UIDs (skipped ${skipped.length} non-UID lines)`);

  const uids = args.limit ? allUids.slice(0, args.limit) : allUids;
  if (uids.length === 0) {
    console.error("error: no UIDs to process after filter (input empty or all lines were non-UID labels)");
    return 2;
  }

  // Load hub bundles once.
  const hubBundles = await loadHubBundles(args.hubDir);
  if (hubBundles.length === 0) {
    console.error(`error: no hub bundles read from ${args.hubDir} (set HUB_BUNDLES_DIR to override)`);
    return 1;
  }
  console.log(`hub bundles: ${hubBundles.length} (${hubBundles.map((b) => basename(b.name)).join(", ")})`);

  await ensureDir(args.outputDir);
  await ensureDir(args.cacheDir);

  const rows: Row[] = [];
  for (let i = 0; i < uids.length; i++) {
    const uid = uids[i];
    const label = `[${i + 1}/${uids.length}]`;
    // Honor pax-ripper's inter-preset delay so back-to-back non-owner Copy
    // flows don't race Pax's per-user rate limits. Skip the wait before the
    // very first UID (no preceding capture to space out).
    if (i > 0 && INTER_PRESET_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, INTER_PRESET_DELAY_MS));
    }
    process.stdout.write(`${label} ${uid} ... `);
    const row = await processUid(uid, args, hubBundles);
    rows.push(row);
    const tag = row.status === "PASS" ? "PASS" : row.status === "SKIP" ? "SKIP" : "FAIL";
    const tail = row.status === "PASS" ? `(${row.elapsedMs}ms)` : `: ${row.detail}`;
    console.log(`${tag} ${tail}`);
    if (row.status === "PASS" && row.elapsedMs > 10 * 60_000) {
      console.warn(`warning: ${uid} took ${(row.elapsedMs / 60_000).toFixed(1)}min`);
    }
  }

  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.filter((r) => r.status === "FAIL").length;
  const skip = rows.filter((r) => r.status === "SKIP").length;
  const elapsedMs = rows.reduce((s, r) => s + r.elapsedMs, 0);
  console.log(`=== SUMMARY processed=${rows.length} pass=${pass} fail=${fail} skip=${skip} elapsed=${(elapsedMs / 1000).toFixed(1)}s ===`);

  if (rows.every((r) => r.status === "SKIP")) return 3;
  if (fail > 0) return 1;
  if (pass === 0) return 2;
  return 0;
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`error: ${(err as Error).message}`);
      process.exit(1);
    });
}