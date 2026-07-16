// ripExtras — scrape additional data from the editor DOM that isn't
// available in the React fiber tree:
//   1. Map feature display symbols (SVG icons selected per feature)
//   2. Polity flag URLs (from the flag picker UI)
//   3. Recommended polity images
//
// These are extracted by clicking through the editor UI and reading
// the DOM state after each click.

import { Page } from 'playwright';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

const P = '[ripExtras]';

/** Result of scraping extras from the editor DOM. */
export interface ExtrasResult {
  /** Map feature ID → display symbol name (e.g. "circle", "star", "diamond") */
  displaySymbols: Record<string, string>;
  /** Polity name → flag URL (e.g. "https://flags.paxhistoria.co/bahraini_flag_...avif") */
  flagURLs: Record<string, string>;
  /** Recommended polity name → image URL */
  polityImages: Record<string, string>;
  /** Number of submenus clicked */
  clicksPerformed: number;
}

/**
 * Scrape display symbols, flag URLs, and polity images from the editor DOM.
 * This is a separate pass after the main ripEditor capture, because these
 * values are only visible when you click on individual items in the editor.
 */
export async function ripExtras(
  page: Page,
  paxID: string,
  version: number,
  targetDir: string,
): Promise<ExtrasResult> {
  const result: ExtrasResult = {
    displaySymbols: {},
    flagURLs: {},
    polityImages: {},
    clicksPerformed: 0,
  };

  console.log(chalk.gray(`${P} Starting extras scrape for ${paxID} v${version}`));

  // 1. Scrape display symbols from map features
  try {
    await scrapeDisplaySymbols(page, result);
  } catch (e) {
    console.log(chalk.yellow(`${P} Display symbol scrape failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  // 2. Scrape flag URLs from polities
  try {
    await scrapeFlagURLs(page, result);
  } catch (e) {
    console.log(chalk.yellow(`${P} Flag URL scrape failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  // 3. Scrape polity images from recommended polities
  try {
    await scrapePolityImages(page, result);
  } catch (e) {
    console.log(chalk.yellow(`${P} Polity image scrape failed: ${e instanceof Error ? e.message : String(e)}`));
  }

  // Save results
  const extrasFile = path.join(targetDir, 'extras.json');
  fs.writeFileSync(extrasFile, JSON.stringify(result, null, 2));
  console.log(chalk.green(
    `${P} ✓ extras.json: ${Object.keys(result.displaySymbols).length} symbols, ` +
    `${Object.keys(result.flagURLs).length} flags, ` +
    `${Object.keys(result.polityImages).length} polity images`
  ));

  return result;
}

/**
 * Scrape display symbols from the map feature editor.
 * 
 * The editor shows a symbol picker with SVG icons. When you click on a
 * map feature, the currently selected symbol is highlighted. We need to:
 * 1. Find the symbol picker UI element
 * 2. Read which symbol is selected
 * 3. Associate it with the current map feature
 */
async function scrapeDisplaySymbols(
  page: Page,
  result: ExtrasResult,
): Promise<void> {
  console.log(chalk.gray(`${P} Scraping display symbols...`));

  // The symbol picker is in the map feature detail panel.
  // We need to find all map feature elements and click on each one.
  const featureCount = await page.evaluate(() => {
    // Find map feature list items in the editor
    const items = document.querySelectorAll('[data-feature-id], [data-map-feature]');
    return items.length;
  });

  if (featureCount === 0) {
    console.log(chalk.gray(`${P} No map features found in DOM`));
    return;
  }

  console.log(chalk.gray(`${P} Found ${featureCount} map features`));

  // For each map feature, click it and read the selected symbol
  for (let i = 0; i < Math.min(featureCount, 50); i++) {
    try {
      const symbol = await page.evaluate((idx: number) => {
        // Find the map feature element
        const items = document.querySelectorAll('[data-feature-id], [data-map-feature], [role="listitem"]');
        const item = items[idx];
        if (!item) return null;

        // Click on it to open the detail panel
        (item as HTMLElement).click();

        // Wait a bit for the panel to update
        return new Promise<string | null>((resolve) => {
          setTimeout(() => {
            // Find the symbol picker in the detail panel
            // Look for the selected/active symbol button
            const selectedSymbol = document.querySelector(
              '[data-selected="true"][data-symbol], ' +
              '.symbol-selected, ' +
              'button[aria-pressed="true"][data-symbol], ' +
              '[class*="selected"][data-symbol]'
            );
            if (selectedSymbol) {
              resolve(selectedSymbol.getAttribute('data-symbol'));
              return;
            }

            // Fallback: look for any symbol attribute on the feature element
            const featureId = item.getAttribute('data-feature-id') || item.getAttribute('data-map-feature');
            const symbolEl = document.querySelector(`[data-feature-symbol="${featureId}"]`);
            if (symbolEl) {
              resolve(symbolEl.getAttribute('data-symbol'));
              return;
            }

            resolve(null);
          }, 300);
        });
      }, i);

      if (symbol) {
        const featureId = await page.evaluate((idx: number) => {
          const items = document.querySelectorAll('[data-feature-id], [data-map-feature], [role="listitem"]');
          const item = items[idx];
          return item?.getAttribute('data-feature-id') || item?.getAttribute('data-map-feature') || `feature_${idx}`;
        }, i);

        result.displaySymbols[featureId] = symbol;
        result.clicksPerformed++;
      }
    } catch {
      // Skip failed features
    }
  }
}

/**
 * Scrape flag URLs from the polity editor.
 * 
 * When you click on a polity, the detail panel shows the flag image.
 * The flag URL follows the pattern: https://flags.paxhistoria.co/{name}_flag_{type}_{era}-compressed.avif
 */
async function scrapeFlagURLs(
  page: Page,
  result: ExtrasResult,
): Promise<void> {
  console.log(chalk.gray(`${P} Scraping flag URLs...`));

  // Find all polity elements in the editor
  const polityCount = await page.evaluate(() => {
    const items = document.querySelectorAll('[data-polity-id], [data-polity], [role="listitem"]');
    return items.length;
  });

  if (polityCount === 0) {
    console.log(chalk.gray(`${P} No polities found in DOM`));
    return;
  }

  console.log(chalk.gray(`${P} Found ${polityCount} polities`));

  // For each polity, click it and read the flag URL
  for (let i = 0; i < Math.min(polityCount, 50); i++) {
    try {
      const flagData = await page.evaluate((idx: number) => {
        const items = document.querySelectorAll('[data-polity-id], [data-polity], [role="listitem"]');
        const item = items[idx];
        if (!item) return null;

        // Click on it to open the detail panel
        (item as HTMLElement).click();

        return new Promise<{ name: string; flagUrl: string | null }>((resolve) => {
          setTimeout(() => {
            const name = item.getAttribute('data-polity-name') ||
              item.getAttribute('data-polity') ||
              item.textContent?.trim().split('\n')[0] ||
              `polity_${idx}`;

            // Find flag image in the detail panel
            const flagImg = document.querySelector(
              'img[src*="flags.paxhistoria.co"], ' +
              'img[src*="flagcdn"], ' +
              '[data-flag-url] img, ' +
              '.flag-image img'
            );

            const flagUrl = flagImg?.getAttribute('src') ||
              document.querySelector('[data-flag-url]')?.getAttribute('data-flag-url') ||
              null;

            resolve({ name, flagUrl });
          }, 300);
        });
      }, i);

      if (flagData?.flagUrl) {
        result.flagURLs[flagData.name] = flagData.flagUrl;
        result.clicksPerformed++;
      }
    } catch {
      // Skip failed polities
    }
  }
}

/**
 * Scrape polity images from recommended polities.
 * 
 * The "Recommended Polities" section shows polity cards with images.
 */
async function scrapePolityImages(
  page: Page,
  result: ExtrasResult,
): Promise<void> {
  console.log(chalk.gray(`${P} Scraping polity images...`));

  // Find recommended polity elements
  const recCount = await page.evaluate(() => {
    const items = document.querySelectorAll(
      '[data-recommended], [data-pick], [data-polity-card], ' +
      '[class*="recommended"] [class*="polity"], ' +
      '[class*="pick"] [class*="card"]'
    );
    return items.length;
  });

  if (recCount === 0) {
    console.log(chalk.gray(`${P} No recommended polities found in DOM`));
    return;
  }

  console.log(chalk.gray(`${P} Found ${recCount} recommended polities`));

  // For each recommended polity, read the image
  for (let i = 0; i < Math.min(recCount, 50); i++) {
    try {
      const polityData = await page.evaluate((idx: number) => {
        const items = document.querySelectorAll(
          '[data-recommended], [data-pick], [data-polity-card], ' +
          '[class*="recommended"] [class*="polity"], ' +
          '[class*="pick"] [class*="card"]'
        );
        const item = items[idx];
        if (!item) return null;

        const name = item.getAttribute('data-polity-name') ||
          item.getAttribute('data-polity') ||
          item.querySelector('[class*="name"]')?.textContent?.trim() ||
          `polity_${idx}`;

        const img = item.querySelector('img');
        const imageUrl = img?.getAttribute('src') || null;

        return { name, imageUrl };
      }, i);

      if (polityData?.imageUrl) {
        result.polityImages[polityData.name] = polityData.imageUrl;
      }
    } catch {
      // Skip failed polities
    }
  }
}
