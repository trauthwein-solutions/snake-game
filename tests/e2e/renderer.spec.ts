import { expect, test as playwrightTest, type Page } from '@playwright/test';

const test = (
  import.meta.env?.MODE === 'test' ? () => undefined : playwrightTest
) as typeof playwrightTest;

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
    }
  });

  return errors;
}

test('renders the deterministic initial state to an accessible DPR-sized canvas', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.goto('/');

  const canvas = page.getByRole('img', { name: 'SNAKISH game arena' });
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveJSProperty('tagName', 'CANVAS');
  await expect(canvas).toHaveAttribute(
    'aria-describedby',
    'arena-instructions',
  );

  const canvasEvidence = await canvas.evaluate((element) => {
    const arena = element as HTMLCanvasElement;
    const bounds = arena.getBoundingClientRect();
    const styles = getComputedStyle(arena);
    const context = arena.getContext('2d');
    if (context === null) {
      throw new Error('Expected the arena to expose a 2D context.');
    }

    const pixels = context.getImageData(0, 0, arena.width, arena.height).data;
    let nonBackgroundPixels = 0;
    const firstPixel = pixels.slice(0, 4);
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index] !== firstPixel[0] ||
        pixels[index + 1] !== firstPixel[1] ||
        pixels[index + 2] !== firstPixel[2] ||
        pixels[index + 3] !== firstPixel[3]
      ) {
        nonBackgroundPixels += 1;
      }
    }

    return {
      backingWidth: arena.width,
      backingHeight: arena.height,
      contentWidth:
        bounds.width -
        Number.parseFloat(styles.borderLeftWidth) -
        Number.parseFloat(styles.borderRightWidth) -
        Number.parseFloat(styles.paddingLeft) -
        Number.parseFloat(styles.paddingRight),
      contentHeight:
        bounds.height -
        Number.parseFloat(styles.borderTopWidth) -
        Number.parseFloat(styles.borderBottomWidth) -
        Number.parseFloat(styles.paddingTop) -
        Number.parseFloat(styles.paddingBottom),
      devicePixelRatio: window.devicePixelRatio,
      nonBackgroundPixels,
    };
  });

  expect(canvasEvidence.backingWidth).toBe(
    Math.round(canvasEvidence.contentWidth * canvasEvidence.devicePixelRatio),
  );
  expect(canvasEvidence.backingHeight).toBe(
    Math.round(canvasEvidence.contentHeight * canvasEvidence.devicePixelRatio),
  );
  expect(canvasEvidence.nonBackgroundPixels).toBeGreaterThan(0);

  const layout = await page.evaluate(() => {
    const arena = document.querySelector<HTMLCanvasElement>('canvas');
    const actions = document.querySelector<HTMLElement>('.game-actions');
    if (arena === null || actions === null) {
      throw new Error('Expected the arena and game actions.');
    }

    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      arenaBottom: arena.getBoundingClientRect().bottom,
      actionsTop: actions.getBoundingClientRect().top,
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.arenaBottom).toBeLessThan(layout.actionsTop);
  expect(browserErrors).toEqual([]);

  await page.screenshot({
    path: 'test-results/renderer-desktop.png',
    fullPage: true,
  });
});

test('redraws the immutable initial frame with a visible timestamp-driven pulse', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');

  const signatures = await page
    .getByRole('img', { name: 'SNAKISH game arena' })
    .evaluate(async (element) => {
      const arena = element as HTMLCanvasElement;
      const context = arena.getContext('2d');
      if (context === null) {
        throw new Error('Expected the arena to expose a 2D context.');
      }

      const signature = (): number => {
        const centerX = Math.round((14.5 / 20) * arena.width);
        const centerY = Math.round((10.5 / 20) * arena.height);
        const side = Math.max(12, Math.round(arena.width / 20));
        const pixels = context.getImageData(
          centerX - Math.floor(side / 2),
          centerY - Math.floor(side / 2),
          side,
          side,
        ).data;
        let hash = 2_166_136_261;
        for (const channel of pixels) {
          hash = Math.imul(hash ^ channel, 16_777_619);
        }
        return hash >>> 0;
      };

      return await new Promise<number[]>((resolve) => {
        const observed = new Set<number>();
        const startedAt = performance.now();
        const sample = (timestamp: number): void => {
          observed.add(signature());
          if (timestamp - startedAt >= 500) {
            resolve([...observed]);
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    });

  expect(signatures.length).toBeGreaterThan(1);
});

test('keeps a stable frame without an app animation loop for reduced motion', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    let callbackCount = 0;
    window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
      requestFrame((timestamp) => {
        callbackCount += 1;
        callback(timestamp);
      });
    Object.defineProperty(window, '__snakishRafCallbackCount', {
      get: () => callbackCount,
    });
  });
  await page.goto('/');

  const canvas = page.getByRole('img', { name: 'SNAKISH game arena' });
  const initialPixels = await canvas.evaluate((element) =>
    (element as HTMLCanvasElement).toDataURL(),
  );
  await page.waitForTimeout(200);
  const settled = await canvas.evaluate((element) => ({
    pixels: (element as HTMLCanvasElement).toDataURL(),
    callbackCount: (
      window as typeof window & {
        __snakishRafCallbackCount: number;
      }
    ).__snakishRafCallbackCount,
  }));

  expect(settled.pixels).toBe(initialPixels);
  expect(settled.callbackCount).toBe(0);
});

test('redraws for successive DPR-only changes without starting a reduced-motion RAF loop', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const requestFrame = window.requestAnimationFrame.bind(window);
    let callbackCount = 0;
    window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
      requestFrame((timestamp) => {
        callbackCount += 1;
        callback(timestamp);
      });
    Object.defineProperty(window, '__snakishRafCallbackCount', {
      get: () => callbackCount,
    });
  });
  await page.goto('/');

  const canvas = page.getByRole('img', { name: 'SNAKISH game arena' });
  const cssSize = await canvas.evaluate((element) => {
    const arena = element as HTMLCanvasElement;
    const bounds = arena.getBoundingClientRect();
    const styles = getComputedStyle(arena);
    return {
      width:
        bounds.width -
        Number.parseFloat(styles.borderLeftWidth) -
        Number.parseFloat(styles.borderRightWidth) -
        Number.parseFloat(styles.paddingLeft) -
        Number.parseFloat(styles.paddingRight),
      height:
        bounds.height -
        Number.parseFloat(styles.borderTopWidth) -
        Number.parseFloat(styles.borderBottomWidth) -
        Number.parseFloat(styles.paddingTop) -
        Number.parseFloat(styles.paddingBottom),
    };
  });
  const viewport = page.viewportSize();
  if (viewport === null) {
    throw new Error('Expected a fixed browser viewport.');
  }
  const session = await page.context().newCDPSession(page);

  for (const deviceScaleFactor of [2, 3]) {
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor,
      mobile: false,
    });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));

    await expect
      .poll(() =>
        canvas.evaluate((element) => ({
          width: (element as HTMLCanvasElement).width,
          height: (element as HTMLCanvasElement).height,
          devicePixelRatio: window.devicePixelRatio,
          callbackCount: (
            window as typeof window & {
              __snakishRafCallbackCount: number;
            }
          ).__snakishRafCallbackCount,
        })),
      )
      .toEqual({
        width: Math.round(cssSize.width * deviceScaleFactor),
        height: Math.round(cssSize.height * deviceScaleFactor),
        devicePixelRatio: deviceScaleFactor,
        callbackCount: 0,
      });
  }
});

test('keeps the existing shell hierarchy clean at 320 CSS pixels', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');

  const layout = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.game-panel');
    const arena = document.querySelector<HTMLCanvasElement>('canvas');
    const actions = document.querySelector<HTMLElement>('.game-actions');
    if (panel === null || arena === null || actions === null) {
      throw new Error('Expected the complete SNAKISH shell hierarchy.');
    }

    const arenaBox = arena.getBoundingClientRect();
    const actionsBox = actions.getBoundingClientRect();
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      arenaBottom: arenaBox.bottom,
      actionsTop: actionsBox.top,
      panelContainsArena: panel.contains(arena),
      panelContainsActions: panel.contains(actions),
    };
  });

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.arenaBottom).toBeLessThan(layout.actionsTop);
  expect(layout.panelContainsArena).toBe(true);
  expect(layout.panelContainsActions).toBe(true);
  expect(browserErrors).toEqual([]);

  await page.screenshot({
    path: 'test-results/renderer-mobile-320.png',
    fullPage: true,
  });
});
