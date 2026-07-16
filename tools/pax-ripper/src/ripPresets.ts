import { Page } from 'playwright';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

const PRESETS_URL = 'https://www.paxhistoria.co/presets/browse?sortBy=roundsPlayed';
const API_URL = '**/api/presets/search';
const PAGE_SIZE = 20;

export async function ripPresets(page: Page, outputDir: string): Promise<string[]> {
  const presetsDir = path.join(outputDir, 'presets');
  fs.mkdirSync(presetsDir, { recursive: true });

  const allPresets: any[] = [];
  const presetIds: string[] = [];
  let pageNum = 0;
  let hasMore = true;

  console.log(chalk.gray(`Navigating to ${PRESETS_URL}`));

  // Set up response interception
  const responsePromise = page.waitForResponse(
    response => response.url().includes('/api/presets/search') && response.status() === 200,
    { timeout: 30000 }
  );

  await page.goto(PRESETS_URL, { waitUntil: 'networkidle' });

  // Wait for initial response
  try {
    const response = await responsePromise;
    const data = await response.json();

    if (data && data.presets) {
      allPresets.push(...data.presets);
      console.log(chalk.gray(`  Page ${pageNum + 1}: ${data.presets.length} presets`));

      // Save page response
      const pageFile = path.join(presetsDir, `search_page_${pageNum + 1}.json`);
      fs.writeFileSync(pageFile, JSON.stringify(data, null, 2));
      console.log(chalk.gray(`  Saved: ${pageFile}`));
    }
  } catch (error) {
    console.log(chalk.yellow(`  Warning: Could not capture initial page`));
  }

  // Scroll to load more
  while (hasMore) {
    pageNum++;
    const from = pageNum * PAGE_SIZE;

    // Set up interception for next page
    const nextPagePromise = page.waitForResponse(
      response => response.url().includes('/api/presets/search') && response.status() === 200,
      { timeout: 15000 }
    ).catch(() => null);

    // Scroll to bottom to trigger loading
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    // Wait a bit for scroll to register
    await new Promise(r => setTimeout(r, 1000));

    // Try to click "Load More" button if it exists
    try {
      const loadMoreBtn = await page.$('button:has-text("Load More"), button:has-text("Show More"), [class*="load-more"]');
      if (loadMoreBtn) {
        await loadMoreBtn.click();
        console.log(chalk.gray(`  Clicked Load More button`));
      }
    } catch {
      // No load more button
    }

    try {
      const response = await nextPagePromise;
      if (response) {
        const data = await response.json();

        if (data && data.presets && data.presets.length > 0) {
          allPresets.push(...data.presets);
          console.log(chalk.gray(`  Page ${pageNum + 1}: ${data.presets.length} presets`));

          // Save page response
          const pageFile = path.join(presetsDir, `search_page_${pageNum + 1}.json`);
          fs.writeFileSync(pageFile, JSON.stringify(data, null, 2));
          console.log(chalk.gray(`  Saved: ${pageFile}`));
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    } catch (error) {
      hasMore = false;
    }

    // Safety limit
    if (pageNum > 50) {
      console.log(chalk.yellow('  Reached page limit (50)'));
      break;
    }
  }

  // Extract preset IDs
  for (const preset of allPresets) {
    const id = preset.uid || preset.id || preset.presetId;
    if (id) {
      presetIds.push(id);
    }
  }

  // Save combined results
  const combinedFile = path.join(presetsDir, 'all_presets.json');
  fs.writeFileSync(combinedFile, JSON.stringify({
    total: allPresets.length,
    presets: allPresets,
    ids: presetIds
  }, null, 2));

  console.log(chalk.gray(`  Saved combined: ${combinedFile}`));

  return presetIds;
}
