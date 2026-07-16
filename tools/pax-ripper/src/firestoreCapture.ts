// firestoreCapture — capture raw Firestore Listen channel responses.
//
// Pax's game state is delivered via Firestore's Listen API
// (google.firestore.v1.Firestore/Listen/channel). The wire format is
// gRPC-Web over HTTP/1.1 long-polling (or HTTP/2 streaming):
//
//   POST https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel
//        ?VER=8&database=projects/pax-historia-dev/databases/(default)
//        &RID=11002&CVER=22&X-HTTP-Session-Id=gsessionid&zx=...&t=1
//
// Each response body is a stream of gRPC-Web frames:
//   [1 byte type][4 bytes big-endian length][payload]
//   type 0x00 = data frame, type 0x80 = trailer
//
// The payload is a Firestore ListenResponse protobuf with fields:
//   2 = DocumentChange (with document.name, document.fields)
//   3 = DocumentDelete
//   4 = DocumentRemove
//   5 = TargetChange
//
// This module captures the raw response bodies to disk for offline
// analysis. The decoder (see firestoreDecode.ts) parses the frames
// and extracts game state.

import { Page, Response as PlaywrightResponse } from 'playwright';
import fs from 'fs';
import path from 'path';

const P = '[firestoreCapture]';

const FIRESTORE_LISTEN_RE =
  /^https:\/\/firestore\.googleapis\.com\/google\.firestore\.v1\.Firestore\/Listen\/channel/;

export interface CapturedFrame {
  /** 1-based index of the response this frame came from */
  responseIndex: number;
  /** URL of the response (full, with all query params) */
  url: string;
  /** HTTP status */
  status: number;
  /** gRPC-Web frame type: 0x00 = data, 0x80 = trailer */
  frameType: number;
  /** Frame payload length in bytes */
  frameLength: number;
  /** Frame payload as a Buffer (raw protobuf bytes) */
  payload: Buffer;
  /** When the frame was captured (ms since epoch) */
  capturedAt: number;
}

/** A single message parsed from the Firestore gapi/JSON channel. */
export interface GapiMessage {
  responseIndex: number;
  url: string;
  status: number;
  /** Length declared by the length-prefix */
  length: number;
  /** Bytes actually received for the JSON payload */
  receivedBytes: number;
  /** Raw JSON text */
  jsonText: string;
  /** Parsed JSON, or null if parse failed */
  json: unknown;
  /** 'incomplete' if the body was truncated; otherwise a JSON parse error message */
  parseError?: string;
  capturedAt: number;
}

export interface FirestoreCaptureHandle {
  /** Number of HTTP responses captured so far */
  responseCount: () => number;
  /** Number of gapi messages parsed so far */
  messageCount: () => number;
  /** All gapi messages captured in order */
  getMessages: () => GapiMessage[];
  /** Stop listening and return the captured data */
  stop: () => GapiMessage[];
}

/**
 * Attach listeners to the page that capture every Firestore Listen
 * response body and parse the gRPC-Web frames out of it. Returns a
 * handle you can stop() to detach the listeners and read the data.
 *
 * @param outputDir - directory to write debug dumps to. Created if missing.
 */
export async function captureFirestoreTraffic(
  page: Page,
  outputDir: string,
): Promise<FirestoreCaptureHandle> {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'api_responses'), { recursive: true });

  const frames: CapturedFrame[] = [];
  const gapiMessages: GapiMessage[] = [];
  let responseIndex = 0;

  // Parse a Firestore gapi/JSON channel body into length-prefixed
  // JSON messages. The format is:
  //   <ascii length>\n<json payload>\n<ascii length>\n<json payload>\n...
  // Each length is the byte count of the JSON payload on the next line.
  // The JSON payload is typically a 3-element array:
  //   [msgType, msgSubtype, payload]
  // where msgType 1 = data, 2 = control, etc.
  const parseGapiMessages = (
    text: string,
    responseIndex: number,
    url: string,
    status: number,
  ): GapiMessage[] => {
    const out: GapiMessage[] = [];
    let offset = 0;
    const now = Date.now();
    while (offset < text.length) {
      const nl = text.indexOf('\n', offset);
      if (nl === -1) break;
      const lenStr = text.slice(offset, nl).trim();
      const len = Number(lenStr);
      if (!Number.isFinite(len) || len < 0) break;
      const jsonStart = nl + 1;
      const jsonEnd = jsonStart + len;
      if (jsonEnd > text.length) {
        // Incomplete — what we have so far
        const partial = text.slice(jsonStart);
        out.push({
          responseIndex,
          url,
          status,
          length: len,
          receivedBytes: partial.length,
          jsonText: partial,
          json: null,
          parseError: 'incomplete',
          capturedAt: now,
        });
        break;
      }
      const jsonText = text.slice(jsonStart, jsonEnd);
      let json: unknown = null;
      let parseError: string | undefined;
      try {
        json = JSON.parse(jsonText);
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e);
      }
      out.push({
        responseIndex,
        url,
        status,
        length: len,
        receivedBytes: jsonText.length,
        jsonText,
        json,
        parseError,
        capturedAt: now,
      });
      // Skip past the JSON + the trailing newline
      offset = jsonEnd + (text[jsonEnd] === '\n' ? 1 : 0);
    }
    return out;
  };

  const onResponse = async (response: PlaywrightResponse) => {
    const url = response.url();
    if (!FIRESTORE_LISTEN_RE.test(url)) return;
    const status = response.status();
    const idx = ++responseIndex;

    console.log(
      `${P}   captured Firestore response #${idx} (HTTP ${status}, ...${url.slice(-60)})`,
    );

    // Save both raw bytes AND decoded text for offline analysis.
    let body: Buffer;
    try {
      body = await response.body();
    } catch (e) {
      console.warn(
        `${P}   could not read body of response #${idx}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return;
    }

    const dumpPath = path.join(
      outputDir,
      'api_responses',
      `firestore_listen_${String(idx).padStart(3, '0')}.bin`,
    );
    fs.writeFileSync(dumpPath, body);

    // Also save decoded text (the gapi channel is text/JSON, not binary)
    const textPath = dumpPath.replace(/\.bin$/, '.txt');
    const text = body.toString('utf-8');
    fs.writeFileSync(textPath, text);
    console.log(
      `${P}     wrote ${body.length} bytes → ${path.basename(dumpPath)} + .txt`,
    );

    // Parse gapi length-prefixed JSON
    const parsed = parseGapiMessages(text, idx, url, status);
    if (parsed.length > 0) {
      const complete = parsed.filter((m) => !m.parseError);
      const incomplete = parsed.filter((m) => m.parseError);
      console.log(
        `${P}     parsed ${parsed.length} gapi message(s) ` +
          `(${complete.length} complete, ${incomplete.length} incomplete)`,
      );
      for (const m of parsed) {
        if (m.json) {
          const j = m.json as unknown[];
          console.log(
            `${P}       msg[${m.length}B]: ${JSON.stringify(j).slice(0, 120)}`,
          );
        } else {
          console.log(
            `${P}       msg[${m.length}B]: (${m.parseError}) text="${m.jsonText.slice(0, 60)}"`,
          );
        }
      }
      gapiMessages.push(...parsed);
    } else {
      console.log(
        `${P}     (no gapi messages parsed — first 5 bytes: ${body
          .subarray(0, 5)
          .toString('hex')})`,
      );
    }
  };

  page.on('response', onResponse as any);

  return {
    responseCount: () => responseIndex,
    messageCount: () => gapiMessages.length,
    getMessages: () => [...gapiMessages],
    stop: () => {
      page.off('response', onResponse as any);
      // Final JSONL dump of all parsed gapi messages (no payload buffer
      // — that's in the .bin/.txt files)
      const summaryPath = path.join(
        outputDir,
        'api_responses',
        'firestore_messages.jsonl',
      );
      const lines = gapiMessages.map((m, i) =>
        JSON.stringify({
          idx: i,
          responseIndex: m.responseIndex,
          url: m.url,
          length: m.length,
          receivedBytes: m.receivedBytes,
          parseError: m.parseError,
          json: m.json,
          capturedAt: m.capturedAt,
        }),
      );
      fs.writeFileSync(summaryPath, lines.join('\n') + '\n');
      console.log(
        `${P} wrote ${gapiMessages.length} gapi message summaries → ${path.basename(summaryPath)}`,
      );
      return [...gapiMessages];
    },
  };
}
