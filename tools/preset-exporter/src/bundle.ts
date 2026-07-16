// bundle.ts - Assemble and write the final scenario bundle JSON.
// Validates the bundle shape per libraryStore.js:729-758 truth-table before write.

import { writeFile } from "node:fs/promises";
import type { BundleAssets, ScenarioBundle, TransformResult } from "./types";
import { BundleError } from "./types";

const REQUIRED_DATA_KEYS = ["actions", "advisor", "chat", "events", "game", "prompts", "world"];

export interface WriteOptions {
  outputPath: string;
  paxID: string;
  version: string;
  mode?: "light" | "full";
  transformDurationMs?: number;
  pmtilesBytes?: { cities?: number; countries?: number; regions?: number };
}

function validateBundle(b: ScenarioBundle): void {
  if (b.schema !== "pax-historia-scenario-bundle") {
    throw new BundleError(`bundle.schema must be "pax-historia-scenario-bundle" (got ${b.schema})`);
  }
  if (b.version !== 1) {
    throw new BundleError(`bundle.version must be 1 (got ${b.version})`);
  }
  const missing = REQUIRED_DATA_KEYS.filter((k) => !(k in b.data));
  if (missing.length > 0) {
    throw new BundleError(
      `bundle.data is missing required keys: ${missing.join(", ")} (these get coerced to empty by libraryStore.js:735-740 and overwrite seeded defaults)`,
    );
  }
}

export async function writeBundle(
  result: TransformResult,
  opts: WriteOptions,
): Promise<void> {
  validateBundle(result.bundle);

  const json = JSON.stringify(
    {
      schema: result.bundle.schema,
      version: result.bundle.version,
      mode: result.bundle.mode,
      exportedAt: result.bundle.exportedAt,
      scenario: result.bundle.scenario,
      data: result.bundle.data,
      assets: result.assets,
    },
    null,
    2,
  );

  await writeFile(opts.outputPath, json + "\n", "utf8");

  const summary = {
    runAt: new Date().toISOString(),
    paxID: opts.paxID,
    version: opts.version,
    mode: opts.mode ?? result.bundle.mode,
    outputBundlePath: opts.outputPath,
    transformDurationMs: opts.transformDurationMs ?? 0,
    pmtilesBytes: opts.pmtilesBytes ?? {},
  };
  await writeFile(`${opts.outputPath}.run_summary.json`, JSON.stringify(summary, null, 2) + "\n", "utf8");
}

export type { BundleAssets };