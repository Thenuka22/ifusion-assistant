import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
const shared = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = path.resolve(process.argv[2] ?? "../TIcketing Package/iFusion-Ticketing-Frontend");
const requireHost = createRequire(path.join(host, "package.json"));
const { createServer } = await import(pathToFileURL(createRequire(requireHost.resolve("vitest/package.json")).resolve("vite")).href);
const { chromium } = requireHost("@playwright/test");
const AxeBuilder = requireHost("@axe-core/playwright").default;
const server = await createServer({ root: path.join(shared, "qa/preview"), configFile: false, server: { host: "127.0.0.1", port: 3188, fs: { allow: [shared] } }, esbuild: { jsx: "automatic" }, resolve: { dedupe: ["react", "react-dom"] } });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  await page.goto("http://127.0.0.1:3188");
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await page.getByRole("button", { name: "Explain this screen", exact: true }).click();
  await page.getByText("Guidance · Stop membership").waitFor();
  await page.waitForTimeout(350);
  const panel = page.getByRole("dialog", { name: "iFusion Assistant" });
  const before = await panel.boundingBox();
  if (before.width !== 460) throw new Error(`Unexpected desktop panel width: ${before.width}`);
  const resize = page.getByRole("separator", { name: "Resize assistant panel" });
  await resize.focus(); await page.keyboard.press("ArrowLeft");
  if (await resize.getAttribute("aria-valuenow") !== "484") throw new Error("Keyboard resize failed");
  await fs.mkdir(path.join(shared, "qa/screenshots"), { recursive: true });
  await page.screenshot({ path: path.join(shared, "qa/screenshots/desktop.png") });
  await page.getByRole("button", { name: "Expand assistant" }).click();
  if (await panel.getAttribute("aria-modal") !== "true") throw new Error("Expanded panel not modal");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "AI assistant", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(350);
  const mobile = await panel.boundingBox();
  if (mobile.width !== 390 || mobile.height !== 844) throw new Error(`Mobile panel does not fill viewport: ${JSON.stringify(mobile)}`);
  await page.screenshot({ path: path.join(shared, "qa/screenshots/mobile.png") });
  const axe = await new AxeBuilder({ page }).include(".assistant-panel").analyze();
  const serious = axe.violations.filter(item => item.impact === "serious" || item.impact === "critical");
  if (serious.length) throw new Error(JSON.stringify(serious.map(item => ({ id: item.id, description: item.description, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Collapse assistant" }).click();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByRole("button", { name: "Start a new conversation" }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(shared, "qa/screenshots/dark-welcome.png") });
  const bounds = await panel.boundingBox();
  for (const control of await page.locator(".assistant-panel__actions button").all()) {
    const box = await control.boundingBox();
    if (box && box.x + box.width > bounds.x + bounds.width) throw new Error("Header controls overflow the assistant panel");
  }
  const dark = await new AxeBuilder({ page }).include(".assistant-panel").analyze();
  const darkFailures = dark.violations.filter(item => item.impact === "serious" || item.impact === "critical");
  if (darkFailures.length) throw new Error(JSON.stringify(darkFailures.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.failureSummary) }))));
  if (failures.length) throw new Error(failures.join("; "));
  console.log("Desktop/mobile layout, keyboard resize, expansion, Escape, guidance and accessibility passed.");
} finally { await browser?.close(); await server.close(); }




