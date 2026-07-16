import { Page } from 'playwright';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

const FLAGS_URL = 'https://www.paxhistoria.co/flags';
const API_URL = '**/api/flags/published/get-published-flags*';

export async function ripFlags(page: Page, outputDir: string): Promise<void> {
  const flagsDir = path.join(outputDir, 'flags');
  const imagesDir = path.join(flagsDir, 'images');
  fs.mkdirSync(flagsDir, { recursive: true });
  fs.mkdirSync(imagesDir, { recursive: true });

  const allFlags: any[] = [];
  let pageNum = 0;
  let hasMore = true;

  console.log(chalk.gray(`Navigating to ${FLAGS_URL}`));

  // Set up response interception
  const responsePromise = page.waitForResponse(
    response => response.url().includes('/api/flags/published/get-published-flags') && response.status() === 200,
    { timeout: 30000 }
  );

  await page.goto(FLAGS_URL, { waitUntil: 'networkidle' });

  // Wait for initial response
  try {
    const response = await responsePromise;
    const data = await response.json();

    if (data && Array.isArray(data)) {
      allFlags.push(...data);
      console.log(chalk.gray(`  Page ${pageNum + 1}: ${data.length} flags`));
    } else if (data && data.flags) {
      allFlags.push(...data.flags);
      console.log(chalk.gray(`  Page ${pageNum + 1}: ${data.flags.length} flags`));
    }
  } catch (error) {
    console.log(chalk.yellow(`  Warning: Could not capture initial page`));
  }

  // Scroll to load more flags
  while (hasMore) {
    pageNum++;

    // Set up interception for next page
    const nextPagePromise = page.waitForResponse(
      response => response.url().includes('/api/flags/published/get-published-flags') && response.status() === 200,
      { timeout: 10000 }
    ).catch(() => null);

    // Scroll to bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });

    await new Promise(r => setTimeout(r, 1000));

    // Try to click load more
    try {
      const loadMoreBtn = await page.$('button:has-text("Load More"), button:has-text("Show More"), [class*="load-more"]');
      if (loadMoreBtn) {
        await loadMoreBtn.click();
      }
    } catch {
      // No button
    }

    try {
      const response = await nextPagePromise;
      if (response) {
        const data = await response.json();
        const flags = Array.isArray(data) ? data : (data.flags || []);

        if (flags.length > 0) {
          allFlags.push(...flags);
          console.log(chalk.gray(`  Page ${pageNum + 1}: ${flags.length} flags`));
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    } catch {
      hasMore = false;
    }

    if (pageNum > 20) {
      console.log(chalk.yellow('  Reached page limit'));
      break;
    }
  }

  // Save metadata
  const metadataFile = path.join(flagsDir, 'metadata.json');
  fs.writeFileSync(metadataFile, JSON.stringify({
    total: allFlags.length,
    flags: allFlags
  }, null, 2));
  console.log(chalk.gray(`  Saved metadata: ${metadataFile}`));

  // Download flag images
  console.log(chalk.gray(`\nDownloading ${allFlags.length} flag images...`));

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < allFlags.length; i++) {
    const flag = allFlags[i];
    const flagId = flag.id || flag.uid || `flag_${i}`;
    const imageUrl = flag.imageUrl || flag.url || flag.src;

    if (!imageUrl) {
      console.log(chalk.yellow(`  [${i + 1}] No image URL`));
      failCount++;
      continue;
    }

    try {
      const response = await page.context().request.get(imageUrl);
      const buffer = await response.body();

      // Determine file extension
      const contentType = response.headers()['content-type'] || '';
      let ext = '.png';
      if (contentType.includes('jpeg') || contentType.includes('jpg')) {
        ext = '.jpg';
      } else if (contentType.includes('webp')) {
        ext = '.webp';
      } else if (contentType.includes('svg')) {
        ext = '.svg';
      }

      const outputFile = path.join(imagesDir, `${flagId}${ext}`);
      fs.writeFileSync(outputFile, buffer);
      console.log(chalk.gray(`  [${i + 1}/${allFlags.length}] ✓ ${flagId}${ext}`));
      successCount++;

    } catch (error) {
      console.log(chalk.red(`  [${i + 1}] ✗ ${flagId}: ${error instanceof Error ? error.message : 'Unknown'}`));
      failCount++;
    }

    // Rate limiting
    if (i < allFlags.length - 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(chalk.blue(`\nFlags rip complete: ${successCount} downloaded, ${failCount} failed`));
}
