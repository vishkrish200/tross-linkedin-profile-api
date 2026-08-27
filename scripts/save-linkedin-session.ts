import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const outputPath = ".auth/linkedin.json";
await mkdir(".auth", { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto("https://www.linkedin.com/login");

const prompt = createInterface({ input, output });
await prompt.question("Sign in manually in the opened browser, then press Enter here to save the session. ");
prompt.close();

await context.storageState({ path: outputPath });
await browser.close();
console.log(`Saved session state to ${outputPath}. This path is ignored by Git.`);
