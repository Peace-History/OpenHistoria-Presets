#!/usr/bin/env bun
// cli.ts - OpenHistoria-Presets preset-exporter CLI.
// Dispatches single-preset, bulk, and offline transform modes.
// Exit codes: 0 ok, 2 capture failure, 3 transform/bundle failure, 4 missing dependency.

import { writeBundle } from "./bundle";
import { loadCaptureFromDir, pickLatestVersionDir } from "./capture";
import { transform } from "./transform";

interface ParsedArgs {
  preset?: string;
  presets?: boolean;
  fromFile?: string;
  all?: boolean;
  offline?: string;
  output?: string;
  mode: "auto" | "light" | "full";
  force: boolean;
  cookiesFile?: string;
  withEditor?: boolean;
  withGame?: boolean;
  noGame?: boolean;
  noFeatures?: boolean;
  featuresOnly?: boolean;
  limit?: number;
  noOverwriteReference: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`OpenHistoria-Presets preset exporter

Usage:
  bun run export --preset <uid> [--output <file>] [--mode <m>]
            Capture a single Pax preset and emit an open-historia scenario bundle.

  bun run export --preset <uid> --offline
            Re-convert an already-captured preset (no network).

  bun run export --offline <dir> --output <file>
            Run the transformer against a captured directory directly.

  bun run export --presets               List preset UIDs via /api/presets/search.
  bun run export --from-file <path>      Bulk: read UIDs one per line and capture each.
  bun run export --all                   Capture everything via the legacy pipeline.

Flags:
  --preset <uid>              Capture a single preset by Pax UID
  --presets                   List preset UIDs (no capture)
  --from-file <path>          Bulk: one UID per line in <path>
  --all                       Capture everything
  --offline <dir>             Skip Playwright; transform from <dir> instead
  --output <path>             Write bundle to <path> (default: ./out/<uid>.json)
  --mode <auto|light|full>    Bundle shape (default: auto; Pax is always full today)
  --force                     Re-capture even when manifest.json exists
  --cookies-file <path>       Cookies JSON for editor auth (HttpOnly OK)
  --with-editor               Scrape the editor view in addition to Play Now
  --with-game                 Force BOTH editor and Play Now flows
  --no-game                   Skip Play Now even if editor fails
  --no-features               Skip map-features capture
  --features-only             Re-run features step only
  --limit <n>                 Cap the number of presets in bulk mode
  --no-overwrite-reference    Refuse to write to out/modern-day.json unless --force
  --help                      Show this message

Examples:
  bun run export --preset 1Alm1zD4pXpGyfWwkch1 --output ./out/cold-war.json
  bun run export --offline out/cache/1Alm1zD4pXpGyfWwkch1/79/ --output ./out/cold-war.json
  bun run export --from-file uids.txt --output ./out --limit 5
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    mode: "auto",
    force: false,
    noOverwriteReference: true,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => argv[++i];
    switch (a) {
      case "--preset": out.preset = take(); break;
      case "--presets": out.presets = true; break;
      case "--from-file": out.fromFile = take(); break;
      case "--all": out.all = true; break;
      case "--offline": out.offline = take(); break;
      case "--output": out.output = take(); break;
      case "--mode": {
        const m = take();
        if (m !== "auto" && m !== "light" && m !== "full") {
          throw new Error(`--mode must be auto|light|full (got ${m})`);
        }
        out.mode = m;
        break;
      }
      case "--force": out.force = true; break;
      case "--cookies-file": out.cookiesFile = take(); break;
      case "--with-editor": out.withEditor = true; break;
      case "--with-game": out.withGame = true; break;
      case "--no-game": out.noGame = true; break;
      case "--no-features": out.noFeatures = true; break;
      case "--features-only": out.featuresOnly = true; break;
      case "--limit": {
        const raw = take();
        const n = parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`--limit must be a non-negative integer (got ${raw})`);
        }
        out.limit = n;
        break;
      }
      case "--no-overwrite-reference": out.noOverwriteReference = true; break;
      case "--help":
      case "-h": out.help = true; break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  return out;
}

function resolveMode(modeArg: "auto" | "light" | "full"): "light" | "full" {
  if (modeArg === "auto") return "full";
  return modeArg;
}

const REFERENCE_PATH = "out/modern-day.json";

async function processOne(
  captureDir: string,
  outputPath: string,
  mode: "auto" | "light" | "full",
  noOverwriteReference: boolean,
  force: boolean,
): Promise<void> {
  if (noOverwriteReference && outputPath === REFERENCE_PATH && !force) {
    throw new Error(
      `refusing to overwrite ${REFERENCE_PATH} (the committed reference). Pass --force or remove --no-overwrite-reference.`,
    );
  }
  const capture = await loadCaptureFromDir(captureDir);
  const startedAt = Date.now();
  const effectiveMode = resolveMode(mode);
  const { bundle, assets } = transform(capture, { mode: effectiveMode });

  await writeBundle(
    { bundle, assets },
    {
      outputPath,
      paxID: capture.preset.id,
      version: String(capture.preset.publishedVersionID ?? "1"),
      mode: effectiveMode,
      transformDurationMs: Date.now() - startedAt,
    },
  );
  console.log(`wrote ${outputPath} (mode=${effectiveMode})`);
}

async function run(args: ParsedArgs): Promise<number> {
  if (args.help) {
    printHelp();
    return 0;
  }

  // Single preset via capture dir: --offline <dir>
  if (args.offline) {
    const outputPath = args.output ?? "./out/bundle.json";
    try {
      await processOne(args.offline, outputPath, args.mode, args.noOverwriteReference, args.force);
      return 0;
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
      return 3;
    }
  }

  // Live single-preset capture. We invoke pax-ripper's CLI glue here because
  // it owns the full Playwright + Firestore REST capture pipeline; the inner
  // library modules are imported by capture.ts when the directory is already captured.
  if (args.preset) {
    const outputPath = args.output ?? `./out/${args.preset}.json`;
    const captureDir = `./out/cache/${args.preset}/`;
    // Delegate to pax-ripper's index.ts so we don't duplicate the capture pipeline.
    const ripArgs = [
      "tools/pax-ripper/src/index.ts",
      "--preset",
      args.preset,
      "--output",
      "./out/cache",
      ...(args.force ? ["--force"] : []),
      ...(args.withEditor ? ["--with-editor"] : []),
      ...(args.withGame ? ["--with-game"] : []),
      ...(args.noGame ? ["--no-game"] : []),
      ...(args.noFeatures ? ["--no-features"] : []),
      ...(args.featuresOnly ? ["--features-only"] : []),
      ...(args.cookiesFile ? ["--cookies", args.cookiesFile] : []),
    ];
    const proc = Bun.spawn(["bun", "run", ...ripArgs], { stdio: ["inherit", "inherit", "inherit"] });
    const code = await proc.exited;
    if (code !== 0) return 2;

    // Find the latest version dir written by pax-ripper (manifest.json inside).
    const versionDir = await pickLatestVersionDir(captureDir);
    if (!versionDir) {
      console.error(`error: pax-ripper did not produce a capture under ${captureDir}`);
      return 2;
    }
    try {
      await processOne(versionDir, outputPath, args.mode, args.noOverwriteReference, args.force);
      return 0;
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
      return 3;
    }
  }

  // Bulk / discovery modes delegate to pax-ripper's CLI for the capture side.
  if (args.presets || args.fromFile || args.all) {
    const ripArgs = ["tools/pax-ripper/src/index.ts"];
    if (args.presets) ripArgs.push("--presets");
    if (args.fromFile) ripArgs.push("--from-file", args.fromFile);
    if (args.all) ripArgs.push("--all");
    if (args.force) ripArgs.push("--force");
    if (args.limit !== undefined) ripArgs.push("--limit", String(args.limit));
    const proc = Bun.spawn(["bun", "run", ...ripArgs], { stdio: ["inherit", "inherit", "inherit"] });
    return proc.exited;
  }

  printHelp();
  return 0;
}

try {
  const args = parseArgs(process.argv.slice(2));
  run(args)
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`error: ${(err as Error).message}`);
      process.exit(3);
    });
} catch (err) {
  console.error(`error: ${(err as Error).message}`);
  process.exit(3);
}