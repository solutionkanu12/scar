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
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
];
const requestedWidth = Number(process.argv[2]);
const viewports = Number.isFinite(requestedWidth) && requestedWidth > 0
  ? requiredViewports.filter((viewport) => viewport.width === requestedWidth)
  : requiredViewports;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function inspectLayout(page, label) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const result = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - viewportWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        if (element.closest(".sidebar:not(.sidebar-open)") && matchMedia("(max-width: 820px)").matches) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.right > viewportWidth + 1 || rect.left < -1);
      })
      .slice(0, 8)
      .map((element) => ({
        className: element.className?.baseVal ?? element.className ?? "",
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right),
        tag: element.tagName,
        text: element.textContent?.trim().slice(0, 60) ?? "",
      }));

    return {
      hasErrorOverlay: Boolean(document.querySelector("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay")),
      offenders,
      overflow,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth,
    };
  });

  assert(!result.hasErrorOverlay, `${label}: an application error overlay is visible`);
  assert(result.overflow <= 1, `${label}: document overflows horizontally by ${result.overflow}px`);
  assert(result.offenders.length === 0, `${label}: visible elements escape the viewport: ${JSON.stringify(result.offenders)}`);
  return result;
}

async function navigateConsole(page, viewportWidth, name, heading) {
  if (viewportWidth <= 820) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
  await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("button", { name, exact: true }).click();
  await page.getByRole("heading", { name: heading }).waitFor();
  assert(await page.getByRole("main").evaluate((element) => element === document.activeElement), `${viewportWidth}px: navigation did not move focus to main content`);
}

async function openConsole(page) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Agents should remember what hurt them." }).waitFor();
  await page.getByRole("button", { name: "Open Scar" }).first().click();
  await page.getByRole("heading", { name: "Every action carries what your agents learned." }).waitFor();
}

async function verifyFullFlow(page, viewport) {
  const label = `${viewport.width}px`;
  await openConsole(page);
  await inspectLayout(page, `${label} activity`);

  await navigateConsole(page, viewport.width, "Agents", "Protection follows every role.");
  await inspectLayout(page, `${label} agents`);
  await navigateConsole(page, viewport.width, "Scars", "Experience your agents do not lose.");
  await page.getByRole("heading", { name: "No organizational Scars yet." }).waitFor();
  await inspectLayout(page, `${label} empty scars`);
  await navigateConsole(page, viewport.width, "Activity", "Every action carries what your agents learned.");

  await page.getByRole("button", { name: "Open Treasury Agent action to Supplier Alpha" }).click();
  await page.getByRole("heading", { name: "Treasury Agent wants to pay Supplier Alpha." }).waitFor();
  await inspectLayout(page, `${label} action inspection`);

  await page.getByRole("button", { name: "Copy Supplier Alpha address" }).click();
  const copiedAddress = await page.evaluate(() => navigator.clipboard.readText());
  assert(copiedAddress === "0x72A8...91C2", `${label}: address copy control copied an unexpected value`);

  await page.getByRole("button", { name: "Check this action" }).click();
  await page.getByRole("heading", { name: "Looking for related incidents..." }).waitFor();
  await inspectLayout(page, `${label} memory searching`);
  await page.getByRole("heading", { name: "ALLOW" }).waitFor({ timeout: 6000 });
  await page.getByText("No relevant Scars").waitFor();
  await inspectLayout(page, `${label} allow`);

  await page.getByRole("button", { name: "Execute on Base" }).click();
  await page.getByRole("heading", { name: "Sending on Base..." }).waitFor();
  await page.getByRole("heading", { name: "Transaction confirmed" }).waitFor({ timeout: 6000 });
  await inspectLayout(page, `${label} execution confirmed`);

  await page.getByRole("button", { name: "Report unsafe outcome" }).click();
  await page.getByRole("dialog", { name: "What should every agent learn from this?" }).waitFor();
  await inspectLayout(page, `${label} incident dialog`);
  await page.getByRole("button", { name: "Save to Sibyl Memory" }).click();
  await page.getByRole("heading", { name: "Scar 0042 now protects future agents." }).waitFor();
  await inspectLayout(page, `${label} incident saved`);

  await page.getByRole("button", { name: "Start a fresh agent session" }).click();
  await page.getByRole("heading", { name: "Procurement Agent wants to pay Supplier Alpha." }).waitFor();
  await page.getByRole("button", { name: "Check this action" }).click();
  await page.getByRole("heading", { name: "Looking for inherited risk..." }).waitFor();
  await page.getByRole("heading", { name: "BLOCK" }).waitFor({ timeout: 6000 });
  assert(await page.getByText("This action did not reach Base.").isVisible(), `${label}: BLOCK does not state that execution was prevented`);
  assert(await page.getByRole("button", { name: "Execute on Base" }).count() === 0, `${label}: BLOCK exposed an execution control`);
  await inspectLayout(page, `${label} block`);

  await page.getByRole("button", { name: "Open source incident" }).click();
  await page.getByRole("heading", { name: "Unexpected settlement behavior" }).waitFor();
  const sourceScrollY = await page.evaluate(() => window.scrollY);
  assert(sourceScrollY <= 1, `${label}: source-incident navigation retained scroll position ${sourceScrollY}px`);
  await page.getByText("Do not execute related transfers automatically.").waitFor();
  await page.getByRole("button", { name: "Copy Base transaction hash" }).click();
  const copiedTransaction = await page.evaluate(() => navigator.clipboard.readText());
  assert(copiedTransaction === "0x8A...92F", `${label}: transaction copy control copied an unexpected value`);
  await inspectLayout(page, `${label} source incident`);

  const screenshot = path.join(outputDirectory, `acceptance-${viewport.width}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  return screenshot;
}

async function verifyResponsiveSurface(page, viewport) {
  const label = `${viewport.width}px`;
  await openConsole(page);
  await inspectLayout(page, `${label} activity`);
  await navigateConsole(page, viewport.width, "Agents", "Protection follows every role.");
  await inspectLayout(page, `${label} agents`);
  await navigateConsole(page, viewport.width, "Scars", "Experience your agents do not lose.");
  await inspectLayout(page, `${label} scars`);
}

async function verifyPublicSurfaces(page, viewport) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Agents should remember what hurt them." }).waitFor();
  const fontState = await page.evaluate(async () => {
    await document.fonts.ready;
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      faces: [...document.fonts].map((face) => ({ family: face.family, status: face.status })),
      fredoka: rootStyle.getPropertyValue("--font-fredoka").trim(),
      nunito: rootStyle.getPropertyValue("--font-nunito").trim(),
    };
  });
  for (const [name, value] of [["Fredoka", fontState.fredoka], ["Nunito", fontState.nunito]]) {
    assert(value.length > 0, `${viewport.width}px: ${name} CSS font variable is missing`);
    const normalized = value.split(",")[0].trim().replaceAll('"', "").replaceAll("'", "");
    assert(fontState.faces.some((face) => face.family.replaceAll('"', "").replaceAll("'", "") === normalized && face.status === "loaded"), `${viewport.width}px: ${name} font face did not load; state: ${JSON.stringify(fontState)}`);
  }
  await inspectLayout(page, `${viewport.width}px landing`);

  await page.keyboard.press("Tab");
  const focus = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
  });
  assert(focus.outlineStyle !== "none" && focus.outlineWidth >= 2, `${viewport.width}px: keyboard focus is not visibly outlined`);

  if (viewport.width <= 720) {
    assert(!(await page.getByRole("link", { name: "How it works" }).isVisible()), `${viewport.width}px: closed public navigation remains visible`);
    const menu = page.getByRole("button", { name: "Open navigation" });
    assert(await menu.getAttribute("aria-controls") === "public-navigation-links", `${viewport.width}px: public menu is not associated with its links`);
    await menu.click();
    await page.getByRole("link", { name: "How it works" }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Close navigation" }).click();
    await page.getByRole("link", { name: "How it works" }).waitFor({ state: "hidden" });
  }

  const pendingAffordances = ["GitHub link pending", "X link pending", "Gmail link pending"];
  for (const name of pendingAffordances) {
    assert(await page.getByRole("button", { name }).isDisabled(), `${viewport.width}px: ${name} is not explicitly disabled`);
  }

  await page.getByRole("button", { name: "Privacy Policy" }).click();
  await page.getByRole("heading", { name: "Privacy Policy" }).waitFor();
  assert(new URL(page.url()).pathname === "/privacy", `${viewport.width}px: Privacy is not addressable`);
  await inspectLayout(page, `${viewport.width}px privacy`);
  await page.goBack();
  await page.getByRole("heading", { name: "Agents should remember what hurt them." }).waitFor();

  await page.getByRole("button", { name: "Terms of Service" }).click();
  await page.getByRole("heading", { name: "Terms of Service" }).waitFor();
  assert(new URL(page.url()).pathname === "/terms", `${viewport.width}px: Terms is not addressable`);
  await inspectLayout(page, `${viewport.width}px terms`);
  await page.goBack();
  await page.getByRole("heading", { name: "Agents should remember what hurt them." }).waitFor();
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
});

const results = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
      reducedMotion: "reduce",
      viewport,
    });
    const page = await context.newPage();
    const browserErrors = [];
    const failedRequests = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("requestfailed", (request) => failedRequests.push(`${request.failure()?.errorText ?? "request failed"}: ${request.url()}`));

    await verifyPublicSurfaces(page, viewport);
    const screenshot = viewport.width === 320 || viewport.width === 1440
      ? await verifyFullFlow(page, viewport)
      : (await verifyResponsiveSurface(page, viewport), null);

    assert(browserErrors.length === 0, `${viewport.width}px: browser errors: ${browserErrors.join(" | ")}; failed requests: ${failedRequests.join(" | ")}`);
    results.push({ browserErrors, failedRequests, fullFlow: Boolean(screenshot), screenshot, viewport });
    await context.close();
  }
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
