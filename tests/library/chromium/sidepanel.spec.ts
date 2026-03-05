/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { BrowserType, BrowserContext } from 'playwright-core';
import { playwrightTest as base, expect } from '../../config/browserTest';

const it = base.extend<{
  launchPersistentContext: (extensionPath: string, options?: Parameters<BrowserType['launchPersistentContext']>[1]) => Promise<BrowserContext>;
}>({
  launchPersistentContext: async ({ browserType }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (extensionPath, options = {}) => {
      const context = await browserType.launchPersistentContext('', {
        ...options,
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          '--enable-unsafe-extension-debugging',
        ],
      });
      contexts.push(context);
      return context;
    });
    await Promise.all(contexts.map(c => c.close()));
  }
});

it.skip(({ isHeadlessShell }) => isHeadlessShell, 'Headless Shell has no support for extensions');
it.skip(({ channel }) => !!channel?.startsWith('chrome'), '--load-extension is not supported in Chrome');

it.describe('Side Panel', () => {
  it.describe.configure({ mode: 'serial' });
  it('should emit sidepanel event when side panel is opened via Extensions.triggerAction', async ({ launchPersistentContext, asset, server }) => {
    const extensionPath = asset('extension-mv3-sidepanel');
    const context = await launchPersistentContext(extensionPath);

    // Get service worker and extension ID; wait for setPanelBehavior to complete
    const serviceWorkers = context.serviceWorkers();
    const sw = serviceWorkers.length ? serviceWorkers[0] : await context.waitForEvent('serviceworker');
    expect(sw).toBeTruthy();
    const extensionId = new URL(sw.url()).hostname;

    // Wait for service worker to finish setPanelBehavior setup
    await sw.evaluate(() => new Promise<void>(resolve => {
      const check = () => {
        if ((globalThis as any).__logs?.some((l: string) => l.includes('setPanelBehavior')))
          resolve();
        else
          setTimeout(check, 50);
      };
      check();
    }));

    // Open a page so a tab exists
    const page = await context.newPage();
    await page.goto(server.EMPTY_PAGE);

    // Get browser CDP session and find the tab target ID
    // Extensions.triggerAction requires a tab target, not a page target
    const browser = context.browser()!;
    const cdp = await (browser as any).newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] });
    const tabTarget = targetInfos.find((t: any) =>
      t.type === 'tab' && t.url === page.url()
    );
    expect(tabTarget).toBeTruthy();

    // Trigger the extension action via CDP (simulates toolbar icon click).
    // The test extension uses setPanelBehavior({ openPanelOnActionClick: true })
    // so Chrome opens the side panel automatically.
    const [panel] = await Promise.all([
      context.waitForEvent('sidepanel', { timeout: 10000 }),
      cdp.send('Extensions.triggerAction', {
        id: extensionId,
        targetId: tabTarget.targetId,
      }),
    ]);

    expect(panel).toBeTruthy();
    await panel.waitForLoadState('domcontentloaded');

    // Verify chrome extension APIs are available in the side panel
    const chromeApis = await panel.evaluate(() => ({
      hasChromeRuntime: typeof chrome !== 'undefined' && !!chrome.runtime,
      hasChromeRuntimeId: typeof chrome !== 'undefined' && chrome.runtime && !!chrome.runtime.id,
    }));
    expect(chromeApis.hasChromeRuntime).toBe(true);
    expect(chromeApis.hasChromeRuntimeId).toBe(true);

    // Verify side panel content
    const heading = await panel.locator('#heading').textContent();
    expect(heading).toBe('Side Panel Content');

    // Verify it's at a chrome-extension:// URL
    expect(panel.url()).toContain('chrome-extension://');
    expect(panel.url()).toContain('sidepanel.html');

    // Interact with the side panel
    await panel.click('#test-button');
    await expect(panel.locator('#result')).toHaveText('Button was clicked!');

    await context.close();
  });

  it('should represent side panel as a Page object with full capabilities', async ({ launchPersistentContext, asset, server }) => {
    const extensionPath = asset('extension-mv3-sidepanel');
    const context = await launchPersistentContext(extensionPath);

    const sw = context.serviceWorkers().length
      ? context.serviceWorkers()[0]
      : await context.waitForEvent('serviceworker');
    const extensionId = new URL(sw.url()).hostname;

    // Wait for service worker to finish setPanelBehavior setup
    await sw.evaluate(() => new Promise<void>(resolve => {
      const check = () => {
        if ((globalThis as any).__logs?.some((l: string) => l.includes('setPanelBehavior')))
          resolve();
        else
          setTimeout(check, 50);
      };
      check();
    }));

    const page = await context.newPage();
    await page.goto(server.EMPTY_PAGE);

    const browser = context.browser()!;
    const cdp = await (browser as any).newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] });
    const tabTarget = targetInfos.find((t: any) =>
      t.type === 'tab' && t.url === page.url()
    );

    const [panel] = await Promise.all([
      context.waitForEvent('sidepanel', { timeout: 10000 }),
      cdp.send('Extensions.triggerAction', {
        id: extensionId,
        targetId: tabTarget.targetId,
      }),
    ]);

    // Verify it's a proper Page with expected capabilities
    const title = await panel.title();
    expect(title).toBe('Test Side Panel');

    // Verify evaluate works
    const bodyText = await panel.evaluate(() => document.body.innerText);
    expect(bodyText).toContain('Side Panel Content');

    // Verify locator works
    await expect(panel.locator('#heading')).toBeVisible();

    await context.close();
  });
});
