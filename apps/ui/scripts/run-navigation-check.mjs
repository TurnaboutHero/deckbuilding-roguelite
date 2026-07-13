import { chromium } from "playwright";
import { preview } from "vite";

const root = new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
const baseUrl = "http://127.0.0.1:4182/deckbuilding-roguelite/";
const failures = [];

const check = (name, condition, detail = "") => {
  console.log(`[${condition ? "ok" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

const server = await preview({
  root,
  preview: { host: "127.0.0.1", port: 4182, strictPort: true },
});
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_EXECUTABLE_PATH === undefined
    ? {}
    : { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH },
);

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors = [];
  const badResponses = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      badResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const layerTokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return [
      "--z-world",
      "--z-stage",
      "--z-controls",
      "--z-popover",
      "--z-tooltip",
      "--z-drag",
      "--z-modal",
      "--z-notice",
    ].map((name) => [name, style.getPropertyValue(name).trim()]);
  });
  check(
    "shared overlay layer tokens exist",
    layerTokens.every(([, value]) => value !== ""),
    layerTokens.filter(([, value]) => value === "").map(([name]) => name).join(", "),
  );

  const hasTitle = (await page.locator('[data-testid="title-screen"]').count()) === 1;
  check("title shown without save", hasTitle);
  if (!hasTitle) {
    throw new Error("title-screen is missing");
  }

  check(
    "continue disabled without save",
    await page.locator('[data-testid="title-continue"]').isDisabled(),
  );
  await page.locator('[data-testid="title-new-run"]').click();
  await page.waitForSelector('[data-testid="character-select"]');

  const cards = page.locator('[data-testid^="character-select-"]');
  const portraits = page.locator('[data-testid="character-portrait"]');
  check("character cards exist", (await cards.count()) >= 5);
  check(
    "each character has a portrait",
    (await portraits.count()) === (await cards.count()),
    `cards=${await cards.count()} portraits=${await portraits.count()}`,
  );

  await page.locator('[data-testid="character-select-warrior"]').click();
  await page.waitForSelector('[data-testid="run-progress"]');
  check(
    "new run persisted",
    (await page.evaluate(() =>
      window.localStorage.getItem("deckbuilding-roguelite.run-save"),
    )) !== null,
  );

  await page.locator('[data-testid="run-menu-open"]').click();
  await page.waitForSelector('[data-testid="run-menu"]');
  await page.keyboard.press("Escape");
  check("escape closes run menu", (await page.locator('[data-testid="run-menu"]').count()) === 0);

  await page.locator('[data-testid="run-menu-open"]').click();
  await page.locator('[data-testid="run-menu-exit"]').click();
  await page.waitForSelector('[data-testid="title-screen"]');
  check("exit preserves continue", !(await page.locator('[data-testid="title-continue"]').isDisabled()));
  check("title shows saved summary", (await page.locator('[data-testid="title-save-summary"]').count()) === 1);

  await page.locator('[data-testid="title-continue"]').click();
  await page.waitForSelector('[data-testid="run-progress"]');

  const attemptBeforeLoad = Number(
    await page.locator(".combat-shell").getAttribute("data-attempt"),
  );
  await page.locator('[data-testid="run-menu-open"]').click();
  await page.locator('[data-testid="run-menu-load"]').click();
  await page.waitForSelector('[data-testid="confirm-action"]');
  await page.locator('[data-testid="confirm-action"]').click();
  await page.waitForSelector('[data-testid="run-progress"]');
  check("saved run reload returns to run", (await page.locator('[data-testid="run-progress"]').count()) === 1);
  const attemptAfterLoad = Number(
    await page.locator(".combat-shell").getAttribute("data-attempt"),
  );
  check(
    "saved combat reload replaces the active session",
    attemptAfterLoad > attemptBeforeLoad,
    `before=${attemptBeforeLoad} after=${attemptAfterLoad}`,
  );

  await page.locator('[data-testid="run-menu-open"]').click();
  await page.locator('[data-testid="run-menu-new"]').click();
  await page.waitForSelector('[data-testid="confirm-action"]');
  check(
    "new run keeps save before confirmation",
    (await page.evaluate(() =>
      window.localStorage.getItem("deckbuilding-roguelite.run-save"),
    )) !== null,
  );
  await page.locator('[data-testid="confirm-action"]').click();
  await page.waitForSelector('[data-testid="character-select"]');
  check(
    "new run clears save after confirmation",
    (await page.evaluate(() =>
      window.localStorage.getItem("deckbuilding-roguelite.run-save"),
    )) === null,
  );

  check("desktop page errors 0", errors.length === 0, errors.join(" | "));
  check("desktop 4xx responses 0", badResponses.length === 0, badResponses.join(" | "));
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${baseUrl}?select=1`, { waitUntil: "networkidle" });
  await mobilePage.waitForSelector('[data-testid="character-select"]');
  check(
    "mobile character select has no horizontal overflow",
    await mobilePage.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  );
  check(
    "mobile uses one character column",
    await mobilePage.locator(".character-grid").evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(" ").length === 1,
    ),
  );
  await mobile.close();
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}

if (failures.length > 0) {
  console.error(`run navigation check FAIL (${failures.length})`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log("run navigation check PASS");
