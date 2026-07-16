// Per-preset manifest + run-level summary writers.

import fs from 'fs';
import path from 'path';
import { CaptureManifest, EditorCaptureStatus, EditorData, FeaturesStatus, RunSummary } from './types.js';

export function writeManifest(
  dir: string,
  manifest: CaptureManifest,
): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  return file;
}

export function writeFeaturesStatus(
  dir: string,
  status: FeaturesStatus,
): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'features_status.json');
  fs.writeFileSync(file, JSON.stringify(status, null, 2));
  return file;
}

export function writeRunSummary(
  presetsDir: string,
  summary: RunSummary,
): string {
  fs.mkdirSync(presetsDir, { recursive: true });
  const file = path.join(presetsDir, '_run_summary.json');
  fs.writeFileSync(file, JSON.stringify(summary, null, 2));
  return file;
}

/** Write editor.json (the rich editor-view data). */
export function writeEditorState(
  dir: string,
  data: EditorData,
): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'editor.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/** Write editor_status.json (capture success/failure with reason). */
export function writeEditorStatus(
  dir: string,
  status: EditorCaptureStatus,
): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'editor_status.json');
  fs.writeFileSync(file, JSON.stringify(status, null, 2));
  return file;
}
