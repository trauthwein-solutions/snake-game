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

interface CdpTouchPoint {
  x: number;
  y: number;
  id?: number;
}

interface CdpTouchEvent {
  type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';
  touchPoints: CdpTouchPoint[];
}

async function dispatchTouchEvents(
  page: Page,
  events: readonly CdpTouchEvent[],
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    for (const event of events) {
      await session.send('Input.dispatchTouchEvent', event);
    }
  } finally {
    await session.detach();
  }
}

async function positionArenaForTouch(
  page: Page,
): Promise<{ x: number; y: number }> {
  const arena = page.getByRole('img', { name: 'SNAKISH game arena' });
  await arena.evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });
  const box = await arena.boundingBox();
  if (box === null) {
    throw new Error('Expected the arena to have bounds.');
  }
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function swipeArena(
  page: Page,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const arena = page.getByRole('img', { name: 'SNAKISH game arena' });
  const box = await arena.boundingBox();
  if (box === null) {
    throw new Error('Expected the arena to have bounds.');
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 3 });
  await page.mouse.up();
}

async function swipeArenaWithTouch(
  page: Page,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  const arena = page.getByRole('img', { name: 'SNAKISH game arena' });
  const box = await arena.boundingBox();
  if (box === null) {
    throw new Error('Expected the arena to have bounds.');
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await dispatchTouchEvents(page, [
    {
      type: 'touchStart',
      touchPoints: [{ x: startX, y: startY }],
    },
    {
      type: 'touchMove',
      touchPoints: [{ x: startX + deltaX / 2, y: startY + deltaY / 2 }],
    },
    {
      type: 'touchMove',
      touchPoints: [{ x: startX + deltaX, y: startY + deltaY }],
    },
    { type: 'touchEnd', touchPoints: [] },
  ]);
}

test('normalizes keyboard directions and pause intent without changing focused settings', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.goto('/');
  const app = page.locator('#app');

  await page.keyboard.press('ArrowUp');
  await expect(app).toHaveAttribute('data-input-direction', 'up');
  await page.keyboard.press('D');
  await expect(app).toHaveAttribute('data-input-direction', 'right');
  await page.keyboard.press('s');
  await expect(app).toHaveAttribute('data-input-direction', 'down');
  await page.keyboard.press('A');
  await expect(app).toHaveAttribute('data-input-direction', 'left');
  await expect(app).toHaveAttribute('data-input-direction-count', '4');

  await page.keyboard.press('p');
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-pause-intent-count', '2');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const music = page.getByRole('checkbox', { name: 'Music', exact: true });
  await expect(music).toBeChecked();
  await music.press('Space');
  await expect(music).not.toBeChecked();
  await music.press('ArrowRight');
  await expect(app).toHaveAttribute('data-input-direction-count', '4');

  expect(browserErrors).toEqual([]);
});

test('allows activate-then-steer from retained game button focus', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.goto('/');
  const app = page.locator('#app');

  const play = page.getByRole('button', { name: 'Play', exact: true });
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await play.click();
  await expect(play).toBeDisabled();
  await expect(play).not.toBeFocused();
  await expect(pause).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(app).toHaveAttribute('data-input-direction', 'right');

  const moveUp = page.getByRole('button', { name: 'Move up', exact: true });
  await moveUp.click();
  await expect(moveUp).toBeFocused();
  await page.keyboard.press('p');
  await expect(app).toHaveAttribute('data-pause-intent-count', '1');

  await page.keyboard.press('Enter');
  await page.keyboard.press('Space');
  await expect(app).toHaveAttribute('data-pause-intent-count', '1');
  expect(browserErrors).toEqual([]);
});

test('preserves modified browser shortcuts without game input or cancellation', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.goto('/');

  const evidence = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('#app');
    if (app === null) {
      throw new Error('Expected the app root.');
    }

    return ['ctrlKey', 'metaKey', 'altKey'].map((modifier) => {
      const event = new KeyboardEvent('keydown', {
        key: modifier === 'altKey' ? 'p' : 'ArrowLeft',
        bubbles: true,
        cancelable: true,
        [modifier]: true,
      });
      const dispatched = document.body.dispatchEvent(event);
      return {
        modifier,
        defaultPrevented: event.defaultPrevented,
        dispatched,
        directionCount: app.dataset.inputDirectionCount ?? '0',
        pauseCount: app.dataset.pauseIntentCount ?? '0',
      };
    });
  });

  expect(evidence).toEqual([
    {
      modifier: 'ctrlKey',
      defaultPrevented: false,
      dispatched: true,
      directionCount: '0',
      pauseCount: '0',
    },
    {
      modifier: 'metaKey',
      defaultPrevented: false,
      dispatched: true,
      directionCount: '0',
      pauseCount: '0',
    },
    {
      modifier: 'altKey',
      defaultPrevented: false,
      dispatched: true,
      directionCount: '0',
      pauseCount: '0',
    },
  ]);
  expect(browserErrors).toEqual([]);
});

test('normalizes real pointer swipes in four directions and rejects weak gestures', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.goto('/');
  const app = page.locator('#app');

  for (const [deltaX, deltaY, direction] of [
    [70, 4, 'right'],
    [-70, 4, 'left'],
    [4, 70, 'down'],
    [4, -70, 'up'],
  ] as const) {
    await swipeArena(page, deltaX, deltaY);
    await expect(app).toHaveAttribute('data-input-direction', direction);
  }
  await expect(app).toHaveAttribute('data-input-direction-count', '4');

  await swipeArena(page, 12, 2);
  await swipeArena(page, 55, 50);
  const arenaBox = await page
    .getByRole('img', { name: 'SNAKISH game arena' })
    .boundingBox();
  if (arenaBox === null) {
    throw new Error('Expected the arena to have bounds.');
  }
  await page.mouse.move(arenaBox.x + arenaBox.width / 2, arenaBox.y - 10);
  await page.mouse.down();
  await page.mouse.move(
    arenaBox.x + arenaBox.width / 2,
    arenaBox.y + arenaBox.height / 2,
  );
  await page.mouse.up();
  await expect(app).toHaveAttribute('data-input-direction-count', '4');
  expect(browserErrors).toEqual([]);

  await page.screenshot({
    path: 'test-results/controls-desktop.png',
    fullPage: true,
  });
});

test('normalizes horizontal and vertical primary touch swipes without pointer cancellation', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 320 });
  await page.goto('/');
  const app = page.locator('#app');
  const arena = page.getByRole('img', { name: 'SNAKISH game arena' });

  await positionArenaForTouch(page);
  const startScrollY = await page.evaluate(() => window.scrollY);

  await arena.evaluate((element) => {
    element.setAttribute('data-pointercancel-count', '0');
    element.addEventListener('pointercancel', () => {
      element.setAttribute(
        'data-pointercancel-count',
        String(
          Number(element.getAttribute('data-pointercancel-count') ?? '0') + 1,
        ),
      );
    });
  });

  await swipeArenaWithTouch(page, 70, 4);
  await expect(app).toHaveAttribute('data-input-direction', 'right');
  await swipeArenaWithTouch(page, 4, -70);
  await expect(app).toHaveAttribute('data-input-direction', 'up');

  await expect(app).toHaveAttribute('data-input-direction-count', '2');
  await expect(arena).toHaveAttribute('data-pointercancel-count', '0');
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBe(startScrollY);
  expect(browserErrors).toEqual([]);
});

test('cancels touch swipes for touchcancel, multi-touch, and starts outside the arena', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 320 });
  await page.goto('/');
  const app = page.locator('#app');
  const arena = page.getByRole('img', { name: 'SNAKISH game arena' });
  const start = await positionArenaForTouch(page);
  const arenaBox = await arena.boundingBox();
  if (arenaBox === null) {
    throw new Error('Expected the arena to have bounds.');
  }

  await arena.evaluate((element) => {
    const evidence: Array<{
      type: string;
      touchCount: number;
      defaultPrevented: boolean;
    }> = [];
    (window as Window & { touchEvidence?: typeof evidence }).touchEvidence =
      evidence;
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      element.addEventListener(type, (event) => {
        evidence.push({
          type,
          touchCount: (event as TouchEvent).touches.length,
          defaultPrevented: event.defaultPrevented,
        });
      });
    }
  });

  await dispatchTouchEvents(page, [
    { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] },
    {
      type: 'touchMove',
      touchPoints: [{ x: start.x + 70, y: start.y + 2, id: 1 }],
    },
    { type: 'touchCancel', touchPoints: [] },
  ]);

  await dispatchTouchEvents(page, [
    { type: 'touchStart', touchPoints: [{ ...start, id: 2 }] },
    {
      type: 'touchStart',
      touchPoints: [
        { ...start, id: 2 },
        { x: start.x + 10, y: start.y + 10, id: 3 },
      ],
    },
    {
      type: 'touchMove',
      touchPoints: [
        { x: start.x - 30, y: start.y, id: 2 },
        { x: start.x + 40, y: start.y + 10, id: 3 },
      ],
    },
    { type: 'touchEnd', touchPoints: [] },
  ]);

  const outsideStart = {
    x: Math.max(0, arenaBox.x - 4),
    y: arenaBox.y + arenaBox.height / 2,
  };
  await dispatchTouchEvents(page, [
    { type: 'touchStart', touchPoints: [{ ...outsideStart, id: 4 }] },
    {
      type: 'touchMove',
      touchPoints: [{ x: start.x + 70, y: start.y, id: 4 }],
    },
    { type: 'touchEnd', touchPoints: [] },
  ]);

  await expect
    .poll(() =>
      app.evaluate((root) =>
        Number((root as HTMLElement).dataset.inputDirectionCount ?? 0),
      ),
    )
    .toBe(0);
  const touchEvidence = await page.evaluate(
    () =>
      (
        window as Window & {
          touchEvidence?: Array<{
            type: string;
            touchCount: number;
            defaultPrevented: boolean;
          }>;
        }
      ).touchEvidence ?? [],
  );
  expect(touchEvidence.length).toBeGreaterThan(0);
  expect(touchEvidence.some(({ touchCount }) => touchCount === 2)).toBe(true);
  expect(touchEvidence.every(({ defaultPrevented }) => !defaultPrevented)).toBe(
    true,
  );
  expect(browserErrors).toEqual([]);
});

test('recovers after a mixed-target multi-touch sequence globally ends', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 320 });
  await page.goto('/');
  const app = page.locator('#app');
  const arena = page.getByRole('img', { name: 'SNAKISH game arena' });
  const start = await positionArenaForTouch(page);
  const arenaBox = await arena.boundingBox();
  if (arenaBox === null) {
    throw new Error('Expected the arena to have bounds.');
  }
  const outside = {
    x: Math.max(1, arenaBox.x - 4),
    y: arenaBox.y + arenaBox.height / 2,
  };
  await page.evaluate(({ x, y }) => {
    if (document.elementFromPoint(x, y)?.closest('.arena-canvas') !== null) {
      throw new Error('Expected the second touch to target outside the arena.');
    }
    const evidence: Array<{
      type: string;
      targetIsArena: boolean;
      touchCount: number;
      defaultPrevented: boolean;
    }> = [];
    (
      window as Window & {
        mixedTouchEvidence?: typeof evidence;
      }
    ).mixedTouchEvidence = evidence;
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      document.addEventListener(type, (event) => {
        evidence.push({
          type,
          targetIsArena:
            event.target instanceof Element &&
            event.target.matches('.arena-canvas'),
          touchCount: (event as TouchEvent).touches.length,
          defaultPrevented: event.defaultPrevented,
        });
      });
    }
  }, outside);

  await dispatchTouchEvents(page, [
    { type: 'touchStart', touchPoints: [{ ...start, id: 31 }] },
    {
      type: 'touchStart',
      touchPoints: [
        { ...start, id: 31 },
        { ...outside, id: 32 },
      ],
    },
    {
      type: 'touchMove',
      touchPoints: [
        { x: start.x + 20, y: start.y, id: 31 },
        { ...outside, id: 32 },
      ],
    },
    { type: 'touchEnd', touchPoints: [] },
    { type: 'touchStart', touchPoints: [{ ...start, id: 33 }] },
    {
      type: 'touchMove',
      touchPoints: [{ x: start.x + 70, y: start.y, id: 33 }],
    },
    { type: 'touchEnd', touchPoints: [] },
  ]);

  await expect(app).toHaveAttribute('data-input-direction', 'right');
  await expect(app).toHaveAttribute('data-input-direction-count', '1');
  const touchEvidence = await page.evaluate(
    () =>
      (
        window as Window & {
          mixedTouchEvidence?: Array<{
            type: string;
            targetIsArena: boolean;
            touchCount: number;
            defaultPrevented: boolean;
          }>;
        }
      ).mixedTouchEvidence ?? [],
  );
  expect(touchEvidence).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'touchend',
        targetIsArena: true,
        touchCount: 1,
      }),
      expect.objectContaining({
        type: 'touchend',
        targetIsArena: false,
        touchCount: 0,
      }),
    ]),
  );
  expect(touchEvidence.every(({ defaultPrevented }) => !defaultPrevented)).toBe(
    true,
  );
  expect(browserErrors).toEqual([]);
});

test('exposes four comfortably sized D-pad controls that emit one command each', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.goto('/');
  const app = page.locator('#app');

  for (const direction of ['up', 'right', 'down', 'left'] as const) {
    const button = page.getByRole('button', {
      name: `Move ${direction}`,
      exact: true,
    });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute('type', 'button');
    const box = await button.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await button.click();
    await expect(app).toHaveAttribute('data-input-direction', direction);
  }

  await expect(app).toHaveAttribute('data-input-direction-count', '4');
  expect(browserErrors).toEqual([]);
});

test('reserves short and ambiguous one-finger arena gestures without emitting direction', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 320 });
  await page.goto('/');

  for (const [deltaX, deltaY] of [
    [3, -24],
    [35, -40],
  ] as const) {
    const start = await positionArenaForTouch(page);
    const startScrollY = await page.evaluate(() => window.scrollY);
    await dispatchTouchEvents(page, [
      { type: 'touchStart', touchPoints: [start] },
      {
        type: 'touchMove',
        touchPoints: [{ x: start.x + deltaX, y: start.y + deltaY }],
      },
      { type: 'touchEnd', touchPoints: [] },
    ]);
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBe(startScrollY);
  }

  const scrollEvidence = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('#app');
    const arena = document.querySelector<HTMLElement>('.arena-canvas');
    const dpad = document.querySelector<HTMLElement>('.dpad');
    if (app === null || arena === null || dpad === null) {
      throw new Error('Expected app, arena, and D-pad controls.');
    }
    return {
      bodyTouchAction: getComputedStyle(document.body).touchAction,
      arenaTouchAction: getComputedStyle(arena).touchAction,
      dpadTouchAction: getComputedStyle(dpad).touchAction,
      directionCount: app.dataset.inputDirectionCount ?? '0',
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    };
  });

  expect(scrollEvidence.bodyTouchAction).not.toBe('none');
  expect(scrollEvidence.arenaTouchAction).toBe('pinch-zoom');
  expect(scrollEvidence.dpadTouchAction).toBe('none');
  expect(scrollEvidence.directionCount).toBe('0');
  expect(scrollEvidence.scrollHeight).toBeGreaterThan(
    scrollEvidence.clientHeight,
  );
  expect(browserErrors).toEqual([]);
});

test('keeps native page scrolling available for a real touch gesture outside reserved controls', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 320 });
  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, 0));

  const start = await page.evaluate(() => {
    const x = 2;
    const y = Math.floor(window.innerHeight * 0.8);
    const target = document.elementFromPoint(x, y);
    if (target !== null && target.closest('.arena-canvas, .dpad') !== null) {
      throw new Error('Expected the touch to begin outside reserved controls.');
    }
    return { x, y };
  });
  const startScrollY = await page.evaluate(() => window.scrollY);

  await dispatchTouchEvents(page, [
    { type: 'touchStart', touchPoints: [start] },
    {
      type: 'touchMove',
      touchPoints: [{ x: start.x, y: start.y - 160 }],
    },
    { type: 'touchEnd', touchPoints: [] },
  ]);

  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(startScrollY);
  await expect
    .poll(() =>
      page
        .locator('#app')
        .evaluate((root) =>
          Number((root as HTMLElement).dataset.inputDirectionCount ?? 0),
        ),
    )
    .toBe(0);
  expect(browserErrors).toEqual([]);
});

test('removes touch swipe listeners during teardown', async ({ page }) => {
  const browserErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 320 });
  await page.goto('/');

  await page.evaluate(async () => {
    const modulePath = '/src/app.ts';
    const { mountApp } = (await import(/* @vite-ignore */ modulePath)) as {
      mountApp: (root: HTMLElement) => () => void;
    };
    const root = document.createElement('div');
    root.id = 'teardown-fixture';
    document.body.append(root);
    const teardown = mountApp(root);
    teardown();
  });

  const arena = page.locator('#teardown-fixture .arena-canvas');
  await arena.evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });
  const box = await arena.boundingBox();
  if (box === null) {
    throw new Error('Expected the teardown arena to have bounds.');
  }
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await dispatchTouchEvents(page, [
    { type: 'touchStart', touchPoints: [start] },
    {
      type: 'touchMove',
      touchPoints: [{ x: start.x + 70, y: start.y }],
    },
    { type: 'touchEnd', touchPoints: [] },
  ]);

  await expect
    .poll(() =>
      page
        .locator('#teardown-fixture')
        .evaluate((root) =>
          Number((root as HTMLElement).dataset.inputDirectionCount ?? 0),
        ),
    )
    .toBe(0);
  expect(browserErrors).toEqual([]);
});

test('fits usable controls at 320px without overflow or overlap', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');

  const layout = await page.evaluate(() => {
    const dpad = document.querySelector<HTMLElement>('.dpad');
    const actions = document.querySelector<HTMLElement>('.game-actions');
    if (dpad === null || actions === null) {
      throw new Error('Expected D-pad and game actions.');
    }
    const dpadBox = dpad.getBoundingClientRect();
    const actionsBox = actions.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dpadBottom: dpadBox.bottom,
      actionsTop: actionsBox.top,
    };
  });

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.dpadBottom).toBeLessThan(layout.actionsTop);
  await expect(page.getByRole('button', { name: 'Move up' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  expect(browserErrors).toEqual([]);

  await page.screenshot({
    path: 'test-results/controls-mobile-320.png',
    fullPage: true,
  });
});
