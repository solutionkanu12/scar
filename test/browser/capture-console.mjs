import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

const label = process.argv[2];
if (!label) throw new Error("Usage: node test/browser/capture-console.mjs <label>");

const outputDirectory = path.join(process.env.TEMP, "scar-browser-qa");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});

const results = [];
for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }]) {
  const context = await browser.newContext({ reducedMotion: "reduce", viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("http://localhost:5173/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Open Scar" }).first().click();
  await page.getByRole("heading", { name: "Every action carries what your agents learned." }).waitFor();

  const screenshot = path.join(outputDirectory, `${label}-${viewport.width}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const state = await page.evaluate(() => ({
    bodyTextLength: document.body.innerText.trim().length,
    hasErrorOverlay: Boolean(document.querySelector("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay")),
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  results.push({ consoleErrors, screenshot, state, viewport });
  await context.close();
}

await browser.close();
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
