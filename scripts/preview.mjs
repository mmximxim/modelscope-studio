import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.PREVIEW_URL ?? "http://127.0.0.1:8788";
const OUT = path.resolve("shots");
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--disable-gpu", "--force-color-profile=srgb"],
});

const page = await browser.newPage();
await page.setBypassServiceWorker(true);
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(URL, { waitUntil: "networkidle0" });
await page.waitForSelector(".brand");
await wait(500);

async function clickText(text, selector = "button") {
  const ok = await page.evaluate(
    (t, sel) => {
      const els = [...document.querySelectorAll(sel)];
      const btn = els.find((e) => (e.textContent ?? "").trim().includes(t));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    text,
    selector,
  );
  await wait(650);
  return ok;
}

async function shot(name, fullPage = false) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
  console.log("shot", name);
}

await shot("01-create");
await shot("01-create-full", true);

await clickText("全部");
await shot("02-model-picker");
await page.evaluate(() => document.querySelector(".sheet-panel .icon-btn")?.click());
await wait(400);

await clickText("作品");
await shot("03-gallery");

await page.evaluate(() => document.querySelector(".gallery-item")?.click());
await wait(700);
await shot("04-viewer");
await page.evaluate(() => document.querySelector(".viewer-bar .icon-btn")?.click());
await wait(400);

await clickText("设置");
await shot("05-settings");
await shot("05-settings-full", true);

await browser.close();
console.log("done ->", OUT);
