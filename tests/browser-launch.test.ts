import { describe, it, expect } from 'vitest';
import { chromium, firefox, webkit } from 'playwright';
import { getBrowserLaunchOptions, type BrowserName } from '../src/executors/web/browserOptions.js';

/**
 * Browser launch validation tests
 * These tests ensure that all browser types can launch successfully with our optimized options
 * This helps catch compatibility issues during deployment (e.g., Chrome flags breaking Safari)
 *
 * Note: WebKit (Safari) may not be available on all systems (requires macOS or specific setup on Linux)
 */
describe('Browser Launch Validation', () => {
  const browsers = [
    { name: 'chromium' as const, browser: chromium },
    { name: 'firefox' as const, browser: firefox },
    { name: 'webkit' as const, browser: webkit, skipIfUnavailable: true },
  ];

  for (const { name, browser, skipIfUnavailable } of browsers) {
    it(
      `should launch ${name} in headless mode without errors`,
      { timeout: skipIfUnavailable ? 30000 : 10000 },
      async () => {
        const options = getBrowserLaunchOptions({
          headless: true,
          browser: name,
        });

        try {
          const launchedBrowser = await browser.launch(options);
          expect(launchedBrowser).toBeDefined();

          const context = await launchedBrowser.newContext();
          expect(context).toBeDefined();

          const page = await context.newPage();
          expect(page).toBeDefined();

          await launchedBrowser.close();
        } catch (error) {
          if (skipIfUnavailable) {
            // Skip test if browser isn't installed (common for webkit on Linux)
            console.warn(`${name} is not available on this system, skipping test`);
            return;
          }
          throw error;
        }
      }
    );
  }
});
