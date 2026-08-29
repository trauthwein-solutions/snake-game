import {
  expect,
  test as playwrightTest,
  type Locator,
  type Page,
} from '@playwright/test';

const test = (
  import.meta.env?.MODE === 'test' ? () => undefined : playwrightTest
) as typeof playwrightTest;

const EVIDENCE_DIRECTORY = 'responsive-evidence';
const SUPPORTED_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 568, height: 320 },
  { width: 667, height: 375 },
  { width: 768, height: 1024 },
  { width: 1366, height: 768 },
] as const;
const FLOOR_VIEWPORTS = [SUPPORTED_VIEWPORTS[0], SUPPORTED_VIEWPORTS[3]];

interface Rectangle {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

interface ShellLayout {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly elements: Readonly<Record<string, Rectangle>>;
  readonly controls: readonly (Rectangle & { readonly name: string })[];
}

function viewportName(viewport: { width: number; height: number }): string {
  return `${viewport.width}x${viewport.height}`;
}

function evidencePath(filename: string): string {
  return `${EVIDENCE_DIRECTORY}/${filename}`;
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function loadGame(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-ready', 'true');
  const elements = [
    page.locator('.app-shell'),
    page.getByRole('heading', { level: 1 }),
    page.locator('.scoreboard'),
    page.getByRole('img', { name: 'SNAKISH game arena' }),
    page.locator('#arena-instructions'),
    page.getByRole('group', { name: 'Directional controls' }),
    page.locator('.game-actions'),
  ];
  for (const element of elements) {
    await expect(element).toBeVisible();
  }
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SNAKISH');
  for (const action of ['Play', 'Pause', 'Restart', 'Settings']) {
    await expect(
      page.getByRole('button', { name: action, exact: true }),
    ).toBeVisible();
  }
  const directionalControls = page.locator('.dpad button');
  await expect(directionalControls).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    await expect(directionalControls.nth(index)).toBeVisible();
  }
}

async function readShellLayout(page: Page): Promise<ShellLayout> {
  return page.evaluate(() => {
    const selectors = {
      shell: '.app-shell',
      title: 'h1',
      scoreboard: '.scoreboard',
      arena: '.arena-canvas',
      instructions: '#arena-instructions',
      dpad: '.dpad',
      actions: '.game-actions',
    };
    const rectangle = (element: Element): Rectangle => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const elements = Object.fromEntries(
      Object.entries(selectors).map(([name, selector]) => {
        const element = document.querySelector(selector);
        if (element === null) {
          throw new Error(`Expected responsive shell element: ${name}.`);
        }
        return [name, rectangle(element)];
      }),
    );
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        '.dpad button, .game-actions button',
      ),
    ].map((control) => ({
      ...rectangle(control),
      name:
        control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
    }));
    const viewport = window.visualViewport;
    return {
      viewportWidth: viewport?.width ?? document.documentElement.clientWidth,
      viewportHeight: viewport?.height ?? document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      elements,
      controls,
    };
  });
}

function expectRectangleInsideViewport(
  rectangle: Rectangle,
  layout: Pick<ShellLayout, 'viewportWidth' | 'viewportHeight'>,
  name: string,
): void {
  expect(rectangle.width, `${name} has visible width`).toBeGreaterThan(0);
  expect(rectangle.height, `${name} has visible height`).toBeGreaterThan(0);
  expect(rectangle.left, `${name} left edge`).toBeGreaterThanOrEqual(0);
  expect(rectangle.top, `${name} top edge`).toBeGreaterThanOrEqual(0);
  expect(rectangle.right, `${name} right edge`).toBeLessThanOrEqual(
    layout.viewportWidth,
  );
  expect(rectangle.bottom, `${name} bottom edge`).toBeLessThanOrEqual(
    layout.viewportHeight,
  );
}

function expectShellLayout(layout: ShellLayout, name: string): void {
  expect(
    layout.scrollWidth,
    `${name}: document horizontal scrolling`,
  ).toBeLessThanOrEqual(layout.viewportWidth);
  expect(
    layout.scrollHeight,
    `${name}: document vertical scrolling`,
  ).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.scrollX, `${name}: initial horizontal scroll position`).toBe(0);
  expect(layout.scrollY, `${name}: initial vertical scroll position`).toBe(0);

  for (const [elementName, rectangle] of Object.entries(layout.elements)) {
    expectRectangleInsideViewport(rectangle, layout, `${name}: ${elementName}`);
  }

  const arena = layout.elements.arena;
  if (arena === undefined) throw new Error('Expected arena dimensions.');
  expect(
    Math.abs(arena.width - arena.height),
    `${name}: square arena difference`,
  ).toBeLessThanOrEqual(1);

  expect(layout.controls, `${name}: primary control count`).toHaveLength(8);
  for (const control of layout.controls) {
    expectRectangleInsideViewport(control, layout, `${name}: ${control.name}`);
    expect(
      control.width,
      `${name}: ${control.name} target width`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      control.height,
      `${name}: ${control.name} target height`,
    ).toBeGreaterThanOrEqual(44);
  }

  const compositionNames = [
    'title',
    'scoreboard',
    'arena',
    'instructions',
    'dpad',
    'actions',
  ];
  for (let leftIndex = 0; leftIndex < compositionNames.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < compositionNames.length;
      rightIndex += 1
    ) {
      const leftName = compositionNames[leftIndex];
      const rightName = compositionNames[rightIndex];
      if (leftName === undefined || rightName === undefined) continue;
      const left = layout.elements[leftName];
      const right = layout.elements[rightName];
      if (left === undefined || right === undefined) {
        throw new Error('Expected composition rectangles.');
      }
      const overlapWidth =
        Math.min(left.right, right.right) - Math.max(left.left, right.left);
      const overlapHeight =
        Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      expect(
        overlapWidth > 0 && overlapHeight > 0,
        `${name}: ${leftName} must not overlap ${rightName}`,
      ).toBe(false);
    }
  }
}

async function expectDialogControls(
  page: Page,
  dialog: Locator,
  name: string,
): Promise<void> {
  const pageLayout = await readShellLayout(page);
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox, `${name}: dialog has rendered bounds`).not.toBeNull();
  if (dialogBox === null) return;
  expectRectangleInsideViewport(
    {
      left: dialogBox.x,
      top: dialogBox.y,
      right: dialogBox.x + dialogBox.width,
      bottom: dialogBox.y + dialogBox.height,
      width: dialogBox.width,
      height: dialogBox.height,
    },
    pageLayout,
    `${name}: dialog`,
  );
  expect(
    pageLayout.scrollWidth,
    `${name}: background horizontal scrolling`,
  ).toBeLessThanOrEqual(pageLayout.viewportWidth);
  expect(
    pageLayout.scrollHeight,
    `${name}: background vertical scrolling`,
  ).toBeLessThanOrEqual(pageLayout.viewportHeight);
  expect(
    pageLayout.scrollX,
    `${name}: background horizontal scroll position`,
  ).toBe(0);
  expect(
    pageLayout.scrollY,
    `${name}: background vertical scroll position`,
  ).toBe(0);
  const dialogOverflow = await dialog.evaluate((element) => ({
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollHeight: element.scrollHeight,
  }));
  if (dialogOverflow.scrollHeight > dialogOverflow.clientHeight) {
    expect(
      ['auto', 'scroll'].includes(dialogOverflow.overflowY),
      `${name}: overflow stays internal to the dialog`,
    ).toBe(true);
  }

  const controls = dialog.locator(
    'button:visible, input[type="checkbox"]:visible, select:visible',
  );
  const count = await controls.count();
  expect(count, `${name}: accessible dialog controls`).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    await control.scrollIntoViewIfNeeded();
    const box = await control.boundingBox();
    const accessibleName =
      (await control.getAttribute('aria-label')) ??
      (await control.getAttribute('name')) ??
      `control ${index + 1}`;
    expect(
      box,
      `${name}: ${accessibleName} has rendered bounds`,
    ).not.toBeNull();
    if (box === null) continue;
    const rectangle = {
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height,
      width: box.width,
      height: box.height,
    };
    expectRectangleInsideViewport(
      rectangle,
      pageLayout,
      `${name}: ${accessibleName}`,
    );
    expect(
      rectangle.width,
      `${name}: ${accessibleName} target width`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      rectangle.height,
      `${name}: ${accessibleName} target height`,
    ).toBeGreaterThanOrEqual(44);
  }
  const backgroundScroll = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
  }));
  expect(backgroundScroll, `${name}: background remains stationary`).toEqual({
    x: 0,
    y: 0,
  });
}

for (const viewport of SUPPORTED_VIEWPORTS) {
  const name = viewportName(viewport);
  test(`fits the complete initial shell at ${name}`, async ({ page }) => {
    const browserErrors = collectPageErrors(page);
    await page.setViewportSize(viewport);
    await loadGame(page);
    const layout = await readShellLayout(page);

    await page.screenshot({ path: evidencePath(`initial-${name}.png`) });
    try {
      expectShellLayout(layout, name);
      expect(browserErrors).toEqual([]);
    } catch (error) {
      await page.screenshot({
        path: evidencePath(`initial-${name}-failure-full-page.png`),
        fullPage: true,
      });
      throw error;
    }
  });
}

for (const viewport of FLOOR_VIEWPORTS) {
  const name = viewportName(viewport);
  test(`contains settings and result dialogs at ${name}`, async ({ page }) => {
    const browserErrors = collectPageErrors(page);
    await page.setViewportSize(viewport);
    await page.clock.install({ time: new Date('2026-01-01T00:00:00.000Z') });
    await page.addInitScript(() => {
      Math.random = () => 0;
    });
    await loadGame(page);
    await page.clock.pauseAt(new Date('2026-01-01T00:01:00.000Z'));

    try {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Settings' });
      await expect(settings).toBeVisible();
      await page.screenshot({ path: evidencePath(`settings-${name}.png`) });
      await expectDialogControls(page, settings, `${name}: settings`);
      await page.keyboard.press('Escape');
      await expect(settings).toBeHidden();

      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await page.clock.runFor(1_800);
      const result = page.getByRole('dialog', { name: 'Game over' });
      await expect(result).toBeVisible();
      await page.screenshot({ path: evidencePath(`result-${name}.png`) });
      await expectDialogControls(page, result, `${name}: result`);
      expect(browserErrors).toEqual([]);
    } catch (error) {
      await page.screenshot({
        path: evidencePath(`dialogs-${name}-failure-full-page.png`),
        fullPage: true,
      });
      throw error;
    }
  });
}

test('records the browser-emulated portrait-to-landscape transition', async ({
  browser,
}, testInfo) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== 'string') {
    throw new Error('Expected the configured base URL.');
  }
  const context = await browser.newContext({
    baseURL,
    hasTouch: true,
    viewport: SUPPORTED_VIEWPORTS[0],
    recordVideo: {
      dir: 'test-results/responsive-video-temp',
      size: { width: 568, height: 568 },
    },
  });
  const page = await context.newPage();
  const browserErrors = collectPageErrors(page);
  const video = page.video();
  let portrait: ShellLayout | undefined;
  let landscape: ShellLayout | undefined;
  try {
    await loadGame(page);
    await page.waitForTimeout(500);
    portrait = await readShellLayout(page);
    await page.screenshot({
      path: evidencePath('transition-portrait-320x568.png'),
    });

    await page.setViewportSize(SUPPORTED_VIEWPORTS[3]);
    await page.waitForTimeout(500);
    landscape = await readShellLayout(page);
    await page.screenshot({
      path: evidencePath('transition-landscape-568x320.png'),
    });
  } finally {
    await context.close();
    await video?.saveAs(
      evidencePath('browser-emulated-portrait-to-landscape.webm'),
    );
  }

  if (portrait === undefined || landscape === undefined) {
    throw new Error('Expected both browser-emulated viewport layouts.');
  }
  expectShellLayout(portrait, 'transition portrait 320x568');
  expectShellLayout(landscape, 'transition landscape 568x320');
  expect(browserErrors).toEqual([]);
});
