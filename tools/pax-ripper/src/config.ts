// Constants — paths, URL templates, timeouts.
//
// Anything that might want to be tuned at runtime lives here so the
// rest of the code reads cleanly.

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** pax-ripper's own internal output dir (legacy `output/`). */
export const PAX_RIPPER_OUTPUT_DIR = path.join(__dirname, '..', 'output');

/** Project root, derived from this file's location: src/config.ts → ../.. */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Default URL list, relative to PROJECT_ROOT. */
export const DEFAULT_PRESETS_FILE = path.join(PROJECT_ROOT, 'presets.txt');

/** Default per-preset output tree. */
export const DEFAULT_PRESETS_DIR = path.join(PROJECT_ROOT, 'presets');

/** Persistent browser profile — reuses your login session. */
export const BROWSER_PROFILE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.config',
  'pax-ripper',
  'browser-profile',
);

/** Pax Historia hosts */
export const PAX_HISTORIA_HOST = 'https://www.paxhistoria.co';
export const PAX_PRESETS_URL = `${PAX_HISTORIA_HOST}/presets`;
export const PAX_BROWSE_URL = `${PAX_PRESETS_URL}/browse?sortBy=roundsPlayed`;
export const PAX_PRESETS_SEARCH_API = '**/api/presets/search';
export const PAX_FLAGS_API = '**/api/flags/published/get-published-flags*';
export const PAX_FLAGS_URL = `${PAX_HISTORIA_HOST}/flags`;

/**
 * The actual editor UI for a preset — used after a Copy → Create a Copy
 * flow. Discovered from the user-captured mitm dump
 * (`/home/john/Projects/Peace-History/dumps/preset_editor.mitm`): the
 * rich polities / mapFeatures / AI prompts / template helpers data
 * lives on this URL, NOT on `/presets/{id}?versionID=N` (the latter is
 * the public detail page and never exposes editor state).
 */
export const PAX_MAP_EDITOR_URL = `${PAX_HISTORIA_HOST}/tools/map-editor`;

/** The auth cookie we look for after the user signs in. */
export const SESSION_COOKIE_NAME = '__session';
export const SESSION_COOKIE_DOMAIN = PAX_HISTORIA_HOST;

/** Timeouts (ms) */
export const TIMEOUTS = {
  /** Per-page navigation */
  pageLoad: 45_000,
  /** Poll window.__NEXT_DATA__ for population (paxhistoria.co is slow) */
  nextDataWait: 45_000,
  /** Geometry response wait */
  geometryResponse: 15_000,
  /** Look for a Play button */
  playButton: 5_000,
  /** Game-state load after Play click (and optional "Play As Country") */
  gameStateLoad: 60_000,
  /** Sign-in wait (2 min) */
  signIn: 120_000,
} as const;

/** Per-preset rate limit (ms) */
export const INTER_PRESET_DELAY_MS = 1_000;

/** Per-asset rate limit (ms) for the existing flag-ripping pass */
export const INTER_FLAG_DELAY_MS = 200;
export const INTER_PRESET_LEGACY_DELAY_MS = 500;

/** Presets to skip (curated; mirrors the Python tools' SKIP_PRESETS) */
export const SKIP_PRESETS = new Set<string>([
  'modern-world-2024',
  'american-civil-war',
  'fall-of-rome',
  'french-revolution',
  'ides-of-march',
  'seven-years-war',
  'thirty-years-war',
  'three-kingdoms',
  'world-war-i',
  'world-war-ii',
  'modern_day',
  'WW2_Europe',
  'europe_1913_simple',
]);

/** Map content-type to a file extension for binary downloads. */
export function extFromContentType(contentType: string, fallbackUrl?: string): string {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('svg')) return '.svg';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('json')) return '.json';
  // Fall back to URL extension
  if (fallbackUrl) {
    const m = fallbackUrl.toLowerCase().match(/\.([a-z0-9]{2,5})(?:\?|$)/);
    if (m) return `.${m[1]}`;
  }
  return '.bin';
}
