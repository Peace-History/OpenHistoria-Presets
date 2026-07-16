/**
 * @deprecated Use `capturePreset` from `./ripPreset.js` instead. This legacy
 * per-slice ripper is kept only so the `--covers` CLI flag keeps working
 * for the old per-slice pipeline. The new flow (driven by
 * `--from-file presets.txt` or `--preset <uid>`) dumps to
 * `presets/{paxID}/{version}/` and combines geometry, covers, and features
 * in a single pass.
 */

import { Page } from 'playwright';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';

const COVER_DOMAIN = '**/preset-assets.paxhistoria.co/**';

export async function ripCovers(page: Page, outputDir: string, presetIds: string[]): Promise<void> {
  const coversDir = path.join(outputDir, 'covers');
  fs.mkdirSync(coversDir, { recursive: true });

  console.log(chalk.gray(`Ripping covers for ${presetIds.length} presets`));

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < presetIds.length; i++) {
    const presetId = presetIds[i];
    const presetDir = path.join(coversDir, presetId);
    const progress = `[${i + 1}/${presetIds.length}]`;

    console.log(chalk.gray(`\n${progress} Processing ${presetId}...`));

    try {
      fs.mkdirSync(presetDir, { recursive: true });

      // Track captured cover URLs
      const capturedUrls = new Set<string>();

      // Set up interception for cover images
      const coverHandler = async (response: any) => {
        try {
          const url = response.url();
          if (url.includes('preset-assets.paxhistoria.co') && !capturedUrls.has(url)) {
            capturedUrls.add(url);
            const contentType = response.headers()['content-type'] || '';

            if (contentType.includes('image')) {
              const buffer = await response.body();
              const urlObj = new URL(url);
              const filename = path.basename(urlObj.pathname);
              const outputFile = path.join(presetDir, filename);

              fs.writeFileSync(outputFile, buffer);
              console.log(chalk.gray(`  ✓ ${filename}`));
            }
          }
        } catch (error) {
          // Ignore errors in handler
        }
      };

      page.on('response', coverHandler);

      // Navigate to preset page
      await page.goto(`https://www.paxhistoria.co/presets/${presetId}`, {
        waitUntil: 'networkidle',
        timeout: 20000
      });

      // Wait a bit for all images to load
      await new Promise(r => setTimeout(r, 2000));

      // Also try to find cover image URLs in page source
      const coverUrls = await page.evaluate(() => {
        const urls: string[] = [];

        // Check meta tags
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage) {
          const content = ogImage.getAttribute('content');
          if (content) urls.push(content);
        }

        // Check for images with cover-like classes
        const images = document.querySelectorAll('img[class*="cover"], img[class*="thumbnail"], img[class*="preview"]');
        images.forEach(img => {
          const src = img.getAttribute('src');
          if (src) urls.push(src);
        });

        // Check Next.js data
        const win = window as any;
        if (win.__NEXT_DATA__) {
          const props = win.__NEXT_DATA__.props?.pageProps;
          if (props?.preset?.coverUrl) urls.push(props.preset.coverUrl);
          if (props?.preset?.thumbnailUrl) urls.push(props.preset.thumbnailUrl);
        }

        return urls;
      });

      // Download any additional cover URLs found
      for (const url of coverUrls) {
        if (!capturedUrls.has(url)) {
          capturedUrls.add(url);
          try {
            const response = await page.context().request.get(url);
            const buffer = await response.body();

            const urlObj = new URL(url);
            const filename = path.basename(urlObj.pathname);
            const outputFile = path.join(presetDir, filename);

            fs.writeFileSync(outputFile, buffer);
            console.log(chalk.gray(`  ✓ ${filename}`));
          } catch (error) {
            console.log(chalk.yellow(`  ⚠ Failed to download: ${url}`));
          }
        }
      }

      page.off('response', coverHandler);

      if (capturedUrls.size > 0) {
        console.log(chalk.green(`  ${capturedUrls.size} images saved`));
        successCount++;
      } else {
        console.log(chalk.yellow(`  ⚠ No cover images found`));
        failCount++;
      }

    } catch (error) {
      console.log(chalk.red(`  ✗ Error: ${error instanceof Error ? error.message : 'Unknown error'}`));
      failCount++;
    }

    // Rate limiting
    if (i < presetIds.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(chalk.blue(`\nCovers rip complete: ${successCount} succeeded, ${failCount} failed`));
}
