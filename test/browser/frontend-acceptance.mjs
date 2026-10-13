import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright";

const baseUrl = "http://localhost:5173";
const outputDirectory = path.join(process.env.TEMP, "scar-browser-qa");
const requiredViewports = [
  { width: 320, height: 800 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 1000 },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function inspectLayout(page, label) {
  const result = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    overlay: Boolean(document.querySelector("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay")),
  }));
  assert(!result.overlay, `${label}: application error overlay is visible`);
  assert(result.overflow <= 1, `${label}: horizontal overflow is ${result.overflow}px`);
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});

const results = [];
try {
  for (const viewport of requiredViewports) {
    const context = await browser.newContext({ reducedMotion: "reduce", viewport });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Agents should remember what hurt them." }).waitFor();
    await inspectLayout(page, `${viewport.width}px landing`);
    await page.getByRole("button", { name: "Open Scar" }).first().click();
    await page.getByRole("heading", { name: "Sign in to SCAR" }).waitFor();
    await inspectLayout(page, `${viewport.width}px auth boundary`);

    const screenshot = path.join(outputDirectory, `auth-boundary-${viewport.width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    assert(errors.length === 0, `${viewport.width}px browser errors: ${errors.join(" | ")}`);
    results.push({ viewport, screenshot });
    await context.close();
  }
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
