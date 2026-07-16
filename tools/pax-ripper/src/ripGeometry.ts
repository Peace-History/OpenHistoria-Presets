/**
 * @deprecated Use `capturePreset` from `./ripPreset.js` instead. This legacy
 * per-slice ripper is kept only so the `--geometry` CLI flag keeps working
 * for the old per-slice pipeline. The new flow (driven by
 * `--from-file presets.txt` or `--preset <uid>`) dumps to
 * `presets/{paxID}/{version}/` and combines geometry, covers, and features
 * in a single pass.
 */

import { Page } from 'playwright';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

const GEOMETRY_DOMAIN = '**/map-geometry.paxhistoria.co/**';

export async function ripGeometry(page: Page, outputDir: string, presetIds: string[]): Promise<void> {
  const geometryDir = path.join(outputDir, 'geometry');
  fs.mkdirSync(geometryDir, { recursive: true });

  console.log(chalk.gray(`Ripping geometry for ${presetIds.length} presets`));

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < presetIds.length; i++) {
    const presetId = presetIds[i];
    const progress = `[${i + 1}/${presetIds.length}]`;

    console.log(chalk.gray(`\n${progress} Processing ${presetId}...`));

    try {
      // Set up geometry interception
      let geometryData: any = null;

      const geometryPromise = new Promise<void>((resolve) => {
        const handler = async (response: any) => {
          try {
            if (response.url().includes('map-geometry.paxhistoria.co')) {
              const contentType = response.headers()['content-type'] || '';
              if (contentType.includes('json') || response.url().endsWith('.json')) {
                geometryData = await response.json();
                console.log(chalk.gray(`  Captured geometry response`));
              }
            }
          } catch (error) {
            // Ignore errors in handler
          }
          resolve();
        };

        page.on('response', handler);

        // Timeout after 10 seconds
        setTimeout(() => {
          page.off('response', handler);
          resolve();
        }, 10000);
      });

      // Navigate to preset page
      await page.goto(`https://www.paxhistoria.co/presets/${presetId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000
      });

      // Wait for geometry request
      await geometryPromise;

      // Also try to find geometry in page scripts or data
      if (!geometryData) {
        geometryData = await page.evaluate(() => {
          // Check for geometry in window object
          const win = window as any;
          if (win.__NEXT_DATA__) {
            const props = win.__NEXT_DATA__.props?.pageProps;
            if (props?.geometry || props?.mapGeometry) {
              return props.geometry || props.mapGeometry;
            }
          }

          // Check for geometry in script tags
          const scripts = document.querySelectorAll('script[type="application/json"]');
          for (const script of scripts) {
            try {
              const data = JSON.parse(script.textContent || '');
              if (data.geometry || data.mapGeometry) {
                return data.geometry || data.mapGeometry;
              }
            } catch {
              // Ignore parse errors
            }
          }

          return null;
        });
      }

      if (geometryData) {
        const outputFile = path.join(geometryDir, `${presetId}.json`);
        fs.writeFileSync(outputFile, JSON.stringify(geometryData, null, 2));
        console.log(chalk.green(`  ✓ Saved geometry`));
        successCount++;
      } else {
        console.log(chalk.yellow(`  ⚠ No geometry data found`));
        failCount++;
      }

    } catch (error) {
      console.log(chalk.red(`  ✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      failCount++;
    }

    // Rate limiting - don't hammer the server
    if (i < presetIds.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(chalk.blue(`\nGeometry rip complete: ${successCount} succeeded, ${failCount} failed`));
}
