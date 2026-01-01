import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
  type Locator as PWLocator,
  type Page,
} from 'playwright';

import type { Action, Locator, TestDefinition } from '../../core/types';
import { InbucketClient } from '../../integrations/email/inbucketClient';
import type { Email } from '../../integrations/email/types';
import { AppwriteTestClient, createTestContext, APPWRITE_PATTERNS, APPWRITE_UPDATE_PATTERNS, APPWRITE_DELETE_PATTERNS, type TrackedResource } from '../../integrations/appwrite';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export interface WebRunOptions {
  baseUrl?: string;
  browser?: BrowserName;
  headed?: boolean;
  screenshotDir?: string;
  defaultTimeoutMs?: number;
  wsEndpoint?: string;
  cdpEndpoint?: string;
}

export interface StepResult {
  action: Action;
  status: 'passed' | 'failed';
  error?: string;
  screenshotPath?: string;
}

export interface WebRunResult {
  status: 'passed' | 'failed';
  steps: StepResult[];
  variables?: Map<string, string>;
}

interface ExecutionContext {
  variables: Map<string, string>;
  lastEmail: Email | null;
  emailClient: InbucketClient | null;
  appwriteContext: import('../../integrations/appwrite/types').TestContext;
}

const defaultScreenshotDir = path.join(process.cwd(), 'artifacts', 'screenshots');

function interpolateVariables(value: string, variables: Map<string, string>): string {
  return value.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    if (varName === 'uuid') {
      return crypto.randomUUID().split('-')[0]; // Short UUID
    }
    return variables.get(varName) ?? match;
  });
}

const resolveUrl = (value: string, baseUrl?: string): string => {
  if (!baseUrl) return value;
  try {
    const url = new URL(value, baseUrl);
    return url.toString();
  } catch {
    return value;
  }
};

const resolveLocator = (page: Page, locator: Locator): PWLocator => {
  if (locator.testId) return page.getByTestId(locator.testId);
  if (locator.text) return page.getByText(locator.text);
  if (locator.css) return page.locator(locator.css);
  if (locator.xpath) return page.locator(`xpath=${locator.xpath}`);
  if (locator.role) {
    const options: { name?: string } = {};
    if (locator.name) options.name = locator.name;
    // playwright typing expects an ARIA role; rely on runtime validation for flexibility
    return page.getByRole(locator.role as any, options);
  }
  if (locator.description) return page.getByText(locator.description);
  throw new Error('No usable selector found for locator');
};

async function ensureScreenshotDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

const runNavigate = async (
  page: Page,
  value: string,
  baseUrl: string | undefined,
  context: ExecutionContext,
): Promise<void> => {
  const interpolated = interpolateVariables(value, context.variables);
  const target = resolveUrl(interpolated, baseUrl);
  await page.goto(target);
};

const runTap = async (page: Page, locator: Locator): Promise<void> => {
  const handle = resolveLocator(page, locator);
  await handle.click();
};

const runInput = async (
  page: Page,
  locator: Locator,
  value: string,
  context: ExecutionContext,
): Promise<void> => {
  const interpolated = interpolateVariables(value, context.variables);
  const handle = resolveLocator(page, locator);
  await handle.fill(interpolated);
};

const runAssert = async (
  page: Page,
  locator: Locator,
  value: string | undefined,
  context: ExecutionContext,
): Promise<void> => {
  const handle = resolveLocator(page, locator);
  await handle.waitFor({ state: 'visible' });
  if (value) {
    const interpolated = interpolateVariables(value, context.variables);
    const text = (await handle.textContent())?.trim() ?? '';
    if (!text.includes(interpolated)) {
      throw new Error(
        `Assertion failed: expected element text to include "${interpolated}", got "${text}"`,
      );
    }
  }
};

const runWait = async (page: Page, action: Extract<Action, { type: 'wait' }>): Promise<void> => {
  if (action.target) {
    const handle = resolveLocator(page, action.target);
    await handle.waitFor({ state: 'visible', timeout: action.timeout });
    return;
  }
  await page.waitForTimeout(action.timeout ?? 1000);
};

const runScroll = async (
  page: Page,
  action: Extract<Action, { type: 'scroll' }>,
): Promise<void> => {
  if (action.target) {
    const handle = resolveLocator(page, action.target);
    await handle.scrollIntoViewIfNeeded();
    return;
  }
  const amount = action.amount ?? 500;
  const direction = action.direction ?? 'down';
  const deltaY = direction === 'up' ? -amount : amount;
  await page.evaluate((value) => window.scrollBy(0, value), deltaY);
};

const runScreenshot = async (
  page: Page,
  name: string | undefined,
  screenshotDir: string,
  stepIndex: number,
): Promise<string> => {
  await ensureScreenshotDir(screenshotDir);
  const filename = name ?? `step-${stepIndex + 1}.png`;
  const filePath = path.join(screenshotDir, filename);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
};

const getBrowser = (browser: BrowserName): BrowserType => {
  switch (browser) {
    case 'firefox':
      return firefox;
    case 'webkit':
      return webkit;
    default:
      return chromium;
  }
};

export const runWebTest = async (
  test: TestDefinition,
  options: WebRunOptions = {},
): Promise<WebRunResult> => {
  if (test.platform !== 'web') {
    throw new Error(`runWebTest only supports web platform, received ${test.platform}`);
  }

  const browserName = options.browser ?? 'chromium';
  const headless = options.headed ? false : true;
  const screenshotDir = options.screenshotDir ?? defaultScreenshotDir;
  const defaultTimeout = options.defaultTimeoutMs ?? 30000;

  // Handle remote browser connections
  let browser: Browser;
  const wsEndpoint = options.wsEndpoint ?? test.config?.web?.wsEndpoint;
  const cdpEndpoint = options.cdpEndpoint ?? test.config?.web?.cdpEndpoint;

  if (wsEndpoint) {
    // Connect to remote Browserless instance via WebSocket
    browser = await chromium.connect(wsEndpoint);
    console.log(`Connected to remote browser at ${wsEndpoint}`);
  } else if (cdpEndpoint) {
    // Connect via Chrome DevTools Protocol
    browser = await chromium.connectOverCDP(cdpEndpoint);
    console.log(`Connected to browser via CDP at ${cdpEndpoint}`);
  } else {
    // Local browser launch
    browser = await getBrowser(browserName).launch({ headless });
  }

  const browserContext = await browser.newContext();
  const page = await browserContext.newPage();
  page.setDefaultTimeout(defaultTimeout);

  // Initialize execution context with variables
  const executionContext: ExecutionContext = {
    variables: new Map<string, string>(),
    lastEmail: null,
    emailClient: null,
    appwriteContext: createTestContext(),
  };

  // Initialize email client if configured
  if (test.config?.email) {
    executionContext.emailClient = new InbucketClient({
      endpoint: test.config.email.endpoint,
    });
  }

  // Set up network interception for Appwrite API responses
  page.on('response', async (response) => {
    const url = response.url();
    const method = response.request().method();

    try {
      // Handle POST requests (resource creation)
      if (method === 'POST') {
        // User created
        if (APPWRITE_PATTERNS.userCreate.test(url)) {
          const data = await response.json();
          executionContext.appwriteContext.userId = data.$id;
          executionContext.appwriteContext.userEmail = data.email;
          return;
        }

        // Row created
        const rowMatch = url.match(APPWRITE_PATTERNS.rowCreate);
        if (rowMatch) {
          const data = await response.json();
          executionContext.appwriteContext.resources.push({
            type: 'row',
            id: data.$id,
            databaseId: rowMatch[1],
            tableId: rowMatch[2],
            createdAt: new Date().toISOString(),
          });
          return;
        }

        // File created
        const fileMatch = url.match(APPWRITE_PATTERNS.fileCreate);
        if (fileMatch) {
          const data = await response.json();
          executionContext.appwriteContext.resources.push({
            type: 'file',
            id: data.$id,
            bucketId: fileMatch[1],
            createdAt: new Date().toISOString(),
          });
          return;
        }

        // Team created
        const teamMatch = url.match(APPWRITE_PATTERNS.teamCreate);
        if (teamMatch) {
          const data = await response.json();
          executionContext.appwriteContext.resources.push({
            type: 'team',
            id: data.$id,
            createdAt: new Date().toISOString(),
          });
          return;
        }

        // Membership created
        const membershipMatch = url.match(APPWRITE_PATTERNS.membershipCreate);
        if (membershipMatch) {
          const data = await response.json();
          executionContext.appwriteContext.resources.push({
            type: 'membership',
            id: data.$id,
            teamId: membershipMatch[1],
            createdAt: new Date().toISOString(),
          });
          return;
        }

        // Message created
        const messageMatch = url.match(APPWRITE_PATTERNS.messageCreate);
        if (messageMatch) {
          const data = await response.json();
          executionContext.appwriteContext.resources.push({
            type: 'message',
            id: data.$id,
            createdAt: new Date().toISOString(),
          });
          return;
        }
      }

      // Handle PUT/PATCH requests (resource updates)
      if (method === 'PUT' || method === 'PATCH') {
        // Row updated
        const rowUpdateMatch = url.match(APPWRITE_UPDATE_PATTERNS.rowUpdate);
        if (rowUpdateMatch) {
          const resourceId = rowUpdateMatch[3];
          const existingResource = executionContext.appwriteContext.resources.find(
            r => r.type === 'row' && r.id === resourceId
          );
          if (!existingResource) {
            // Resource was updated but not created in this test - track it for potential cleanup
            executionContext.appwriteContext.resources.push({
              type: 'row',
              id: resourceId,
              databaseId: rowUpdateMatch[1],
              tableId: rowUpdateMatch[2],
              createdAt: new Date().toISOString(),
            });
          }
          return;
        }

        // File updated
        const fileUpdateMatch = url.match(APPWRITE_UPDATE_PATTERNS.fileUpdate);
        if (fileUpdateMatch) {
          const resourceId = fileUpdateMatch[2];
          const existingResource = executionContext.appwriteContext.resources.find(
            r => r.type === 'file' && r.id === resourceId
          );
          if (!existingResource) {
            // Resource was updated but not created in this test - track it for potential cleanup
            executionContext.appwriteContext.resources.push({
              type: 'file',
              id: resourceId,
              bucketId: fileUpdateMatch[1],
              createdAt: new Date().toISOString(),
            });
          }
          return;
        }

        // Team updated
        const teamUpdateMatch = url.match(APPWRITE_UPDATE_PATTERNS.teamUpdate);
        if (teamUpdateMatch) {
          const resourceId = teamUpdateMatch[1];
          const existingResource = executionContext.appwriteContext.resources.find(
            r => r.type === 'team' && r.id === resourceId
          );
          if (!existingResource) {
            // Resource was updated but not created in this test - track it for potential cleanup
            executionContext.appwriteContext.resources.push({
              type: 'team',
              id: resourceId,
              createdAt: new Date().toISOString(),
            });
          }
          return;
        }
      }

      // Handle DELETE requests (mark resources as deleted)
      if (method === 'DELETE') {
        // Row deleted
        const rowDeleteMatch = url.match(APPWRITE_DELETE_PATTERNS.rowDelete);
        if (rowDeleteMatch) {
          const resourceId = rowDeleteMatch[3];
          const resource = executionContext.appwriteContext.resources.find(
            r => r.type === 'row' && r.id === resourceId
          );
          if (resource) {
            resource.deleted = true;
          }
          return;
        }

        // File deleted
        const fileDeleteMatch = url.match(APPWRITE_DELETE_PATTERNS.fileDelete);
        if (fileDeleteMatch) {
          const resourceId = fileDeleteMatch[2];
          const resource = executionContext.appwriteContext.resources.find(
            r => r.type === 'file' && r.id === resourceId
          );
          if (resource) {
            resource.deleted = true;
          }
          return;
        }

        // Team deleted
        const teamDeleteMatch = url.match(APPWRITE_DELETE_PATTERNS.teamDelete);
        if (teamDeleteMatch) {
          const resourceId = teamDeleteMatch[1];
          const resource = executionContext.appwriteContext.resources.find(
            r => r.type === 'team' && r.id === resourceId
          );
          if (resource) {
            resource.deleted = true;
          }
          return;
        }

        // Membership deleted
        const membershipDeleteMatch = url.match(APPWRITE_DELETE_PATTERNS.membershipDelete);
        if (membershipDeleteMatch) {
          const resourceId = membershipDeleteMatch[2];
          const resource = executionContext.appwriteContext.resources.find(
            r => r.type === 'membership' && r.id === resourceId
          );
          if (resource) {
            resource.deleted = true;
          }
          return;
        }
      }
    } catch (e) {
      // Ignore parse errors for non-JSON responses
    }
  });

  // Initialize variables from test definition
  if (test.variables) {
    for (const [key, value] of Object.entries(test.variables)) {
      // Interpolate variable values to handle nested {{uuid}}
      const interpolated = interpolateVariables(value, executionContext.variables);
      executionContext.variables.set(key, interpolated);
    }
  }

  const results: StepResult[] = [];
  try {
    for (const [index, action] of test.steps.entries()) {
      try {
        switch (action.type) {
          case 'navigate':
            await runNavigate(
              page,
              action.value,
              options.baseUrl ?? test.config?.web?.baseUrl,
              executionContext,
            );
            break;
          case 'tap':
            await runTap(page, action.target);
            break;
          case 'input':
            await runInput(page, action.target, action.value, executionContext);
            break;
          case 'assert':
            await runAssert(page, action.target, action.value, executionContext);
            break;
          case 'wait':
            await runWait(page, action);
            break;
          case 'scroll':
            await runScroll(page, action);
            break;
          case 'screenshot': {
            const screenshotPath = await runScreenshot(page, action.name, screenshotDir, index);
            results.push({ action, status: 'passed', screenshotPath });
            continue;
          }
          case 'setVar': {
            let value: string;
            if (action.value) {
              value = interpolateVariables(action.value, executionContext.variables);
            } else if (action.from === 'response') {
              // Extract from last network response (future)
              throw new Error('setVar from response not yet implemented');
            } else if (action.from === 'element') {
              // Extract from DOM element (future)
              throw new Error('setVar from element not yet implemented');
            } else if (action.from === 'email') {
              // Already handled by email.extractCode/extractLink
              throw new Error('Use email.extractCode or email.extractLink instead');
            } else {
              throw new Error('setVar requires value or from');
            }
            executionContext.variables.set(action.name, value);
            break;
          }
          case 'email.waitFor': {
            if (!executionContext.emailClient) {
              throw new Error('Email client not configured');
            }
            const mailbox = interpolateVariables(action.mailbox, executionContext.variables);
            executionContext.lastEmail = await executionContext.emailClient.waitForEmail(mailbox, {
              timeout: action.timeout,
              subjectContains: action.subjectContains,
            });
            break;
          }
          case 'email.extractCode': {
            if (!executionContext.emailClient) {
              throw new Error('Email client not configured');
            }
            if (!executionContext.lastEmail) {
              throw new Error('No email loaded - call email.waitFor first');
            }
            const code = executionContext.emailClient.extractCode(
              executionContext.lastEmail,
              action.pattern ? new RegExp(action.pattern) : undefined,
            );
            if (!code) {
              throw new Error('No code found in email');
            }
            executionContext.variables.set(action.saveTo, code);
            break;
          }
          case 'email.extractLink': {
            if (!executionContext.emailClient) {
              throw new Error('Email client not configured');
            }
            if (!executionContext.lastEmail) {
              throw new Error('No email loaded - call email.waitFor first');
            }
            const link = executionContext.emailClient.extractLink(
              executionContext.lastEmail,
              action.pattern ? new RegExp(action.pattern) : undefined,
            );
            if (!link) {
              throw new Error('No link found in email');
            }
            executionContext.variables.set(action.saveTo, link);
            break;
          }
          case 'email.clear': {
            if (!executionContext.emailClient) {
              throw new Error('Email client not configured');
            }
            const mailbox = interpolateVariables(action.mailbox, executionContext.variables);
            await executionContext.emailClient.clearMailbox(mailbox);
            break;
          }
          default:
            // Exhaustiveness guard
            throw new Error(`Unsupported action type: ${(action as Action).type}`);
        }
        results.push({ action, status: 'passed' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ action, status: 'failed', error: message });
        throw error;
      }
    }
  } finally {
    // Run Appwrite cleanup if configured
    if (test.config?.appwrite?.cleanup) {
      const appwriteClient = new AppwriteTestClient({
        endpoint: test.config.appwrite.endpoint,
        projectId: test.config.appwrite.projectId,
        apiKey: test.config.appwrite.apiKey,
        cleanup: true,
      });

      const cleanupResult = await appwriteClient.cleanup(executionContext.appwriteContext);
      console.log('Cleanup result:', cleanupResult);
    }

    await browserContext.close();
    await browser.close();
  }

  return {
    status: results.every((step) => step.status === 'passed') ? 'passed' : 'failed',
    steps: results,
    variables: executionContext.variables,
  };
};
