#!/usr/bin/env node
// Diagnostic: navigate to a stuck UID's preset page, click Copy, observe what happens.
// Usage: node scripts/_diag_copy.cjs <UID>

const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const UID = process.argv[2];
if (!UID) { console.error("usage: node scripts/_diag_copy.cjs <UID>"); process.exit(1); }

const PROFILE = "/home/john/.config/pax-ripper/browser-profile";
const OUTDIR = path.join("out", "diag", `${UID}-${Date.now()}`);
fs.mkdirSync(OUTDIR, { recursive: true });

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = ctx.pages()[0] || await ctx.newPage();

  console.log("=== 1. Navigate to preset page");
  await page.goto(`https://www.paxhistoria.co/presets/${UID}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(OUTDIR, "01-loaded.png"), fullPage: true });

  console.log("=== 2. Look for Copy button");
  const copyBtns = await page.locator('button:has-text("Copy")').all();
  console.log(`Found ${copyBtns.length} buttons with text "Copy"`);
  for (let i = 0; i < copyBtns.length; i++) {
    const txt = await copyBtns[i].textContent().catch(() => "?");
    const visible = await copyBtns[i].isVisible().catch(() => false);
    console.log(`  [${i}] visible=${visible} text="${(txt||"").slice(0,60)}"`);
  }

  console.log("=== 3. Click the most likely Copy button");
  let clicked = false;
  for (const b of copyBtns) {
    const v = await b.isVisible().catch(() => false);
    if (v) {
      const t = (await b.textContent()) || "";
      if (t.includes("Copy") && !t.includes("Create")) {
        console.log(`  clicking button text="${t.slice(0,60)}"`);
        await b.click();
        clicked = true;
        break;
      }
    }
  }
  if (!clicked) console.log("  no Copy button clicked");

  console.log("=== 4. Wait 5s, then dump DOM + screenshot");
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(OUTDIR, "02-after-click-5s.png"), fullPage: true });
  const html5 = await page.content();
  fs.writeFileSync(path.join(OUTDIR, "02-after-click-5s.html"), html5);

  // Look for any modal/popup
  const modals = await page.locator('[role="dialog"], .modal, [class*="modal"], [class*="popup"]').all();
  console.log(`  Found ${modals.length} modal/popup-like elements`);
  for (let i = 0; i < Math.min(modals.length, 5); i++) {
    const visible = await modals[i].isVisible().catch(() => false);
    const text = (await modals[i].textContent().catch(() => "")) || "";
    console.log(`    [${i}] visible=${visible} text="${text.slice(0,80).replace(/\s+/g," ")}"`);
  }

  // Look for "Create a Copy" button anywhere on page now
  const createCopyBtns = await page.locator('button:has-text("Create a Copy")').all();
  console.log(`  Found ${createCopyBtns.length} "Create a Copy" buttons`);
  for (let i = 0; i < createCopyBtns.length; i++) {
    const visible = await createCopyBtns[i].isVisible().catch(() => false);
    console.log(`    [${i}] visible=${visible}`);
  }

  console.log("=== 5. Wait another 15s");
  await page.waitForTimeout(15000);
  await page.screenshot({ path: path.join(OUTDIR, "03-after-click-20s.png"), fullPage: true });
  const html20 = await page.content();
  fs.writeFileSync(path.join(OUTDIR, "03-after-click-20s.html"), html20);
  const createCopyBtns2 = await page.locator('button:has-text("Create a Copy")').all();
  console.log(`  After 20s total: ${createCopyBtns2.length} "Create a Copy" buttons`);

  console.log(`\nArtifacts written to ${OUTDIR}/`);
  await ctx.close();
})();
