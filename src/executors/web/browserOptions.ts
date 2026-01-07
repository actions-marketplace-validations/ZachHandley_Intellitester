/**
 * Performance-optimized browser launch options
 * These settings help with slow page loads and work well in both local and CI/Docker environments
 */

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export interface BrowserLaunchOptions {
  headless: boolean;
  browser?: BrowserName;
}

/**
 * Get optimized launch options for Playwright browsers
 * Returns browser-specific options to avoid compatibility issues
 */
export function getBrowserLaunchOptions(options: BrowserLaunchOptions) {
  const { headless, browser } = options;

  // Chromium-specific flags (not supported by Firefox/WebKit)
  if (browser === 'chromium' || !browser) {
    return {
      headless,
      args: [
        // Shared memory - critical for Docker/CI, harmless locally
        '--disable-dev-shm-usage',

        // GPU acceleration - not needed in headless mode
        '--disable-gpu',

        // Reduce overhead
        '--disable-extensions',

        // Prevent JavaScript throttling (helps with slow page loads)
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',

        // Process isolation - reduces overhead for testing
        '--disable-features=IsolateOrigins,site-per-process',

        // Networking tweaks
        '--disable-features=VizDisplayCompositor',
        '--disable-blink-features=AutomationControlled',
      ],
    };
  }

  // Firefox-specific optimizations (via firefoxUserPrefs)
  if (browser === 'firefox') {
    return {
      headless,
      firefoxUserPrefs: {
        // Enable JIT (disabled in automation mode by default, causes 2-4x JS slowdown)
        'javascript.options.jit': true,
        // Disable fission for stability/speed
        'fission.autostart': false,
        // Disable hardware acceleration overhead in headless
        'layers.acceleration.disabled': true,
        'gfx.webrender.all': false,
      },
    };
  }

  // WebKit/Safari - minimal options (no Chrome flags supported)
  return { headless };
}
