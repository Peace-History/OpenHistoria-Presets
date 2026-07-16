// firestoreExtract — pull the simplePresets/{paxID} document from
// Firestore via the REST API.
//
// The mitm dump and a live test (paxhistoria.co/presets/jjDMOB) both
// confirmed:
//   1. Visiting a preset URL triggers the page to subscribe to the
//      simplePresets/{paxID} Firestore document via the Listen channel.
//   2. The same document is reachable via the REST endpoint
//      /v1/projects/{db}/databases/(default)/documents/simplePresets/{id},
//      which returns clean JSON (no gapi framing, no protobuf).
//   3. The cookies the page uses are valid for `pax-historia-dev`
//      (production returns 403 in the dev account).
//
// The REST approach is dramatically simpler than parsing the gapi
// channel: one HTTP GET, one JSON parse, and we have the full doc.

import { Page } from 'playwright';
import chalk from 'chalk';

const P = '[firestoreExtract]';

const FIRESTORE_REST_URL = (db: string, paxID: string) =>
  `https://firestore.googleapis.com/v1/projects/${db}/databases/(default)/documents/simplePresets/${paxID}`;

/**
 * Fetch every document in a top-level Firestore collection via the REST
 * `listDocuments` endpoint. Returns a map of `id → fields-decoded-record`,
 * or null if both databases returned non-200.
 *
 * Used for collections that are publicly readable on paxhistoria.co
 * (e.g. `promptStore`, `templateHelpers` — both verified to return 200
 * without auth).
 */
export async function fetchCollectionFromFirestore(
  page: Page,
  collectionPath: string,
): Promise<{ db: string; docs: Record<string, Record<string, unknown>> } | null> {
  const FIRESTORE_LIST = (db: string) =>
    `https://firestore.googleapis.com/v1/projects/${db}/databases/(default)/documents/${collectionPath}?pageSize=300`;
  for (const db of ['pax-historia-dev', 'pax-historia']) {
    const url = FIRESTORE_LIST(db);
    let res;
    try {
      res = await page.context().request.get(url, { timeout: 30_000 });
    } catch (e) {
      console.log(
        chalk.gray(
          `${P}   ${db} collection ${collectionPath} request failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
      continue;
    }
    if (!res.ok()) {
      console.log(
        chalk.gray(`${P}   ${db} collection ${collectionPath} returned HTTP ${res.status()}`),
      );
      continue;
    }
    const text = await res.text();
    let parsed: { documents?: Array<{ name?: string; fields?: Record<string, unknown> }> };
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const out: Record<string, Record<string, unknown>> = {};
    for (const doc of parsed.documents ?? []) {
      if (!doc.name || !doc.fields) continue;
      const id = doc.name.split('/').pop() ?? doc.name;
      const decoded: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(doc.fields)) {
        decoded[k] = firestoreValueToJs(v);
      }
      out[id] = decoded;
    }
    console.log(
      chalk.green(
        `${P}   ✓ fetched ${db} ${collectionPath}: ${Object.keys(out).length} doc(s) (${text.length} bytes)`,
      ),
    );
    return { db, docs: out };
  }
  return null;
}

/** Convert a Firestore JSON Value to a plain JS value. */
export function firestoreValueToJs(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(firestoreValueToJs);
  const obj = v as Record<string, unknown>;
  if ('stringValue' in obj) return obj.stringValue;
  if ('integerValue' in obj) {
    const n = Number(obj.integerValue);
    return Number.isFinite(n) ? n : obj.integerValue;
  }
  if ('doubleValue' in obj) {
    const n = Number(obj.doubleValue);
    return Number.isFinite(n) ? n : obj.doubleValue;
  }
  if ('booleanValue' in obj) return !!obj.booleanValue;
  if ('nullValue' in obj) return null;
  if ('timestampValue' in obj) return obj.timestampValue;
  if ('geoPointValue' in obj) return obj.geoPointValue;
  if ('referenceValue' in obj) return obj.referenceValue;
  if ('bytesValue' in obj) return obj.bytesValue;
  if ('mapValue' in obj) {
    const m = obj.mapValue as { fields?: Record<string, unknown> };
    if (m && typeof m === 'object' && m.fields) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(m.fields)) {
        out[k] = firestoreValueToJs(val);
      }
      return out;
    }
    return obj.mapValue;
  }
  if ('arrayValue' in obj) {
    const a = obj.arrayValue as { values?: unknown[] };
    if (a && typeof a === 'object' && Array.isArray(a.values)) {
      return a.values.map(firestoreValueToJs);
    }
    return obj.arrayValue;
  }
  return obj;
}

/** Try the REST endpoint for the simplePresets document. Returns the
 * raw `fields` block (decoded from Firestore Values), or null. */
export async function fetchPresetFromFirestore(
  page: Page,
  paxID: string,
): Promise<{ db: string; raw: Record<string, unknown>; bytes: number } | null> {
  // Try `pax-historia-dev` first (the dev environment the user has
  // access to). Fall back to `pax-historia` (prod) in case the
  // user happens to have prod access.
  for (const db of ['pax-historia-dev', 'pax-historia']) {
    const url = FIRESTORE_REST_URL(db, paxID);
    let res;
    try {
      res = await page.context().request.get(url, { timeout: 15_000 });
    } catch (e) {
      console.log(
        chalk.gray(`${P}   request to ${db} failed: ${e instanceof Error ? e.message : String(e)}`),
      );
      continue;
    }
    if (!res.ok()) {
      console.log(
        chalk.gray(
          `${P}   ${db} returned HTTP ${res.status()} (skipping)`,
        ),
      );
      continue;
    }
    const text = await res.text();
    let parsed: { name?: string; fields?: Record<string, unknown> };
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.warn(
        `${P}   ${db} returned non-JSON body: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    if (!parsed.fields) {
      console.log(chalk.gray(`${P}   ${db} returned no fields`));
      continue;
    }
    const decoded: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.fields)) {
      decoded[k] = firestoreValueToJs(v);
    }
    console.log(
      chalk.green(
        `${P}   ✓ fetched ${db} simplePresets/${paxID} (${text.length} bytes, ` +
          `${Object.keys(decoded).length} fields)`,
      ),
    );
    return { db, raw: decoded, bytes: text.length };
  }
  return null;
}

/**
 * Fetch a single Firestore document by REST path (e.g. `userPublicProfiles/abc123`).
 * Returns the decoded `fields` block or null. Used for author profile lookups
 * during editor capture — verified publicly readable via REST on 2026-06-20.
 * Callers: ripEditor.ts (inside the public-collections augmentation block).
 * Output schema mirrors fetchPresetFromFirestore: { db, raw(fields), bytes }.
 */
export async function fetchDocumentFromFirestore(
  page: Page,
  docPath: string,
): Promise<{ db: string; raw: Record<string, unknown>; bytes: number } | null> {
  for (const db of ['pax-historia-dev', 'pax-historia']) {
    const url = `https://firestore.googleapis.com/v1/projects/${db}/databases/(default)/documents/${docPath}`;
    let res;
    try {
      res = await page.context().request.get(url, { timeout: 15_000 });
    } catch (e) {
      console.log(
        chalk.gray(
          `${P}   request to ${db}/${docPath} failed: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
      continue;
    }
    if (!res.ok()) {
      console.log(
        chalk.gray(`${P}   ${db}/${docPath} returned HTTP ${res.status()} (skipping)`),
      );
      continue;
    }
    const text = await res.text();
    let parsed: { name?: string; fields?: Record<string, unknown> };
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.warn(
        `${P}   ${db}/${docPath} returned non-JSON body: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    if (!parsed.fields) {
      console.log(chalk.gray(`${P}   ${db}/${docPath} returned no fields`));
      continue;
    }
    const decoded: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed.fields)) {
      decoded[k] = firestoreValueToJs(v);
    }
    console.log(
      chalk.green(
        `${P}   ✓ fetched ${db}/${docPath} (${text.length} bytes, ${Object.keys(decoded).length} fields)`,
      ),
    );
    return { db, raw: decoded, bytes: text.length };
  }
  return null;
}

/**
 * Build a PresetData-compatible object from the Firestore document
 * fields. Maps the dump-observed fields to our standard shape.
 */
export function firestoreDocToPresetFields(
  doc: Record<string, unknown>,
  paxID: string,
  versionFallback: number,
): {
  id: string;
  publishedVersionID: number;
  title: string;
  description: string;
  coverImageURL?: string;
  landingImageURL?: string;
  geometryURL?: string;
  authorUID?: string;
  tags: string[];
  roundsPlayed: number;
  gamesStarted: number;
  slug?: string;
  extras: Record<string, unknown>;
} {
  const versionDescriptions =
    (doc.versionDescriptions as Record<string, unknown>) || {};
  const versionKeys = Object.keys(versionDescriptions)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n));
  const publishedVersionID =
    typeof doc.publishedVersionID === 'number'
      ? (doc.publishedVersionID as number)
      : versionKeys.length > 0
        ? Math.max(...versionKeys)
        : versionFallback;

  return {
    id: (doc.presetUID as string) || paxID,
    publishedVersionID,
    title: (doc.title as string) || (doc.draftTitle as string) || '',
    description:
      (doc.description as string) || (doc.draftDescription as string) || '',
    coverImageURL:
      (doc.coverImageURL as string) || (doc.draftCoverImageURL as string),
    landingImageURL:
      (doc.landingImageURL as string) || (doc.draftLandingImageURL as string),
    geometryURL: doc.geometryURL as string | undefined,
    authorUID: doc.authorUID as string | undefined,
    tags: Array.isArray(doc.presetCategory)
      ? (doc.presetCategory as unknown[]).map((t) => String(t))
      : [],
    roundsPlayed:
      typeof doc.roundsPlayed === 'number' ? (doc.roundsPlayed as number) : 0,
    gamesStarted:
      typeof doc.gamesStarted === 'number' ? (doc.gamesStarted as number) : 0,
    slug: (doc.slug as string) || (doc.presetUID as string),
    extras: {
      versionDescriptions,
      copiedFrom: doc.copiedFrom,
      favorites: doc.favorites,
      copyCount: doc.copyCount,
      award_tokens: doc.awardedTokens,
      presetCategoryString: doc.presetCategoryString,
      countrySelectionFrequency: doc.countrySelectionFrequency,
      capturedFrom: 'firestore_rest',
    },
  };
}
