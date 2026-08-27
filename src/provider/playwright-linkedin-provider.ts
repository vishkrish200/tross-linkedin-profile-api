import { readFile } from "node:fs/promises";
import { chromium, type BrowserContextOptions } from "playwright";
import { extractProfileFromHtml } from "./extract-profile.js";
import {
  ProviderAuthenticationError,
  ProviderFetchError,
  ProviderNotConfiguredError,
  type ProfileProvider,
} from "./profile-provider.js";

export type LinkedInProviderConfig = {
  storageStatePath?: string;
  storageStateBase64?: string;
  navigationTimeoutMs?: number;
};

async function storageState(
  config: LinkedInProviderConfig,
): Promise<NonNullable<BrowserContextOptions["storageState"]>> {
  if (config.storageStateBase64) {
    try {
      return JSON.parse(Buffer.from(config.storageStateBase64, "base64").toString("utf8"));
    } catch {
      throw new ProviderNotConfiguredError("LINKEDIN_STORAGE_STATE_B64 is not valid base64-encoded JSON");
    }
  }

  if (config.storageStatePath) {
    try {
      return JSON.parse(await readFile(config.storageStatePath, "utf8"));
    } catch {
      throw new ProviderNotConfiguredError(`Cannot read LinkedIn storage state at ${config.storageStatePath}`);
    }
  }

  throw new ProviderNotConfiguredError();
}

export class PlaywrightLinkedInProvider implements ProfileProvider {
  constructor(private readonly config: LinkedInProviderConfig) {}

  async fetch(profileUrl: string) {
    const state = await storageState(this.config);
    const browser = await chromium.launch({ headless: true });

    try {
      const context = await browser.newContext({
        storageState: state,
        locale: "en-US",
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs ?? 30_000);

      const response = await page.goto(profileUrl, { waitUntil: "domcontentloaded" });
      if (!response || response.status() >= 500) {
        throw new ProviderFetchError(`LinkedIn returned ${response?.status() ?? "no response"}`);
      }

      const currentUrl = page.url();
      if (/\/login|\/checkpoint|authwall/i.test(currentUrl)) {
        throw new ProviderAuthenticationError();
      }

      await page.locator("main").waitFor({ state: "visible", timeout: 15_000 });
      for (let index = 0; index < 5; index += 1) {
        await page.mouse.wheel(0, 900);
        await page.waitForTimeout(250);
      }

      const expandButtons = page.getByRole("button", { name: /see more/i });
      const count = Math.min(await expandButtons.count(), 12);
      for (let index = 0; index < count; index += 1) {
        await expandButtons.nth(index).click({ timeout: 750 }).catch(() => undefined);
      }

      return extractProfileFromHtml(await page.content(), profileUrl);
    } catch (error) {
      if (
        error instanceof ProviderNotConfiguredError ||
        error instanceof ProviderAuthenticationError ||
        error instanceof ProviderFetchError
      ) {
        throw error;
      }
      throw new ProviderFetchError(error instanceof Error ? error.message : undefined);
    } finally {
      await browser.close();
    }
  }
}
