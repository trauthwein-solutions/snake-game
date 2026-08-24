import { expect, test as playwrightTest, type Page } from '@playwright/test';

const test = (
  import.meta.env?.MODE === 'test' ? () => undefined : playwrightTest
) as typeof playwrightTest;

const CLOCK_INSTALL_TIME = new Date('2026-01-01T00:00:00.000Z');
const CLOCK_PAUSE_TIME = new Date('2026-01-01T00:01:00.000Z');

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function loadWithControlledClock(page: Page): Promise<void> {
  await page.clock.install({ time: CLOCK_INSTALL_TIME });
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto('/');
  await page.clock.pauseAt(CLOCK_PAUSE_TIME);
}

async function dispatchVisibilityChange(
  page: Page,
  hidden: boolean,
): Promise<void> {
  // Playwright-controlled Chromium does not expose real tab visibility transitions here.
  // This override provides deterministic handler/order evidence, not a native lifecycle transition.
  await page.evaluate((nextHidden) => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: nextHidden,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

async function nativeClickWasDispatched(
  page: Page,
  selector: string,
): Promise<boolean> {
  return page.locator(selector).evaluate((element) => {
    let dispatched = false;
    const recordClick = (): void => {
      dispatched = true;
    };
    element.addEventListener('click', recordClick);
    (element as HTMLButtonElement).click();
    element.removeEventListener('click', recordClick);
    return dispatched;
  });
}

async function expectActionControls(
  page: Page,
  expected: {
    pauseClass: string;
    pauseDisabled: boolean;
    pauseLabel: 'Pause' | 'Resume';
    playClass: string;
    playDisabled: boolean;
  },
): Promise<void> {
  const play = page.locator('[data-action="play"]');
  const pause = page.locator('[data-action="pause"]');
  const restart = page.locator('[data-action="restart"]');
  const settings = page.locator('[data-action="settings"]');

  await expect(play).toHaveClass(expected.playClass);
  await expect(pause).toHaveClass(expected.pauseClass);
  await expect(pause).toHaveText(expected.pauseLabel);
  if (expected.playDisabled) {
    await expect(play).toBeDisabled();
    await expect(play).toHaveAttribute('disabled', '');
  } else {
    await expect(play).toBeEnabled();
    await expect(play).not.toHaveAttribute('disabled', '');
  }
  if (expected.pauseDisabled) {
    await expect(pause).toBeDisabled();
    await expect(pause).toHaveAttribute('disabled', '');
  } else {
    await expect(pause).toBeEnabled();
    await expect(pause).not.toHaveAttribute('disabled', '');
  }
  await expect(play).not.toHaveAttribute('aria-disabled');
  await expect(pause).not.toHaveAttribute('aria-disabled');
  await expect(restart).toBeEnabled();
  await expect(settings).toBeEnabled();
}

test('action controls expose native disabled semantics and one truthful primary action', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);
  const app = page.locator('#app');

  await expectActionControls(page, {
    playDisabled: false,
    playClass: 'button button--primary',
    pauseDisabled: true,
    pauseClass: 'button',
    pauseLabel: 'Pause',
  });
  expect(await nativeClickWasDispatched(page, '[data-action="pause"]')).toBe(
    false,
  );
  await expect(app).toHaveAttribute('data-game-status', 'ready');
  await expect(app).not.toHaveAttribute('data-pause-intent-count');

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expectActionControls(page, {
    playDisabled: true,
    playClass: 'button',
    pauseDisabled: false,
    pauseClass: 'button button--primary',
    pauseLabel: 'Pause',
  });
  expect(await nativeClickWasDispatched(page, '[data-action="play"]')).toBe(
    false,
  );
  await expect(app).toHaveAttribute('data-game-status', 'running');

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expectActionControls(page, {
    playDisabled: true,
    playClass: 'button',
    pauseDisabled: false,
    pauseClass: 'button button--primary',
    pauseLabel: 'Resume',
  });
  expect(await nativeClickWasDispatched(page, '[data-action="play"]')).toBe(
    false,
  );
  await expect(app).toHaveAttribute('data-game-status', 'paused');

  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.clock.runFor(1_800);
  await expect(app).toHaveAttribute('data-game-status', 'gameOver');
  await expectActionControls(page, {
    playDisabled: true,
    playClass: 'button',
    pauseDisabled: true,
    pauseClass: 'button',
    pauseLabel: 'Pause',
  });
  expect(await nativeClickWasDispatched(page, '[data-action="play"]')).toBe(
    false,
  );
  expect(await nativeClickWasDispatched(page, '[data-action="pause"]')).toBe(
    false,
  );
  await expect(app).toHaveAttribute('data-game-status', 'gameOver');
  await expect(
    page
      .getByRole('dialog', { name: 'Game over' })
      .getByRole('button', { name: 'Play again' }),
  ).toBeFocused();
  expect(browserErrors).toEqual([]);
});

test('pause button clears elapsed debt and resume waits a complete interval', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);
  const app = page.locator('#app');
  const pause = page.getByRole('button', { name: 'Pause', exact: true });

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(179);
  await pause.click();
  await expect(app).toHaveAttribute('data-game-status', 'paused');
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect(page.locator('[role="status"]')).toHaveText('Game paused.');
  await page.screenshot({
    path: 'test-results/pause-safety-desktop.png',
    fullPage: true,
  });

  await page.clock.runFor(10_000);
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(app).toHaveAttribute('data-game-status', 'running');
  await expect(page.locator('[role="status"]')).toHaveText('Game resumed.');
  await page.clock.runFor(179);
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await page.clock.runFor(1);
  await expect(app).toHaveAttribute('data-game-head', '11,10');
  expect(browserErrors).toEqual([]);
});

test('P and Escape toggle active play while result-dialog Escape remains dialog-owned', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);
  const app = page.locator('#app');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  await page.keyboard.press('p');
  await expect(app).toHaveAttribute('data-game-status', 'paused');
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-game-status', 'running');
  await page.keyboard.press('P');
  await expect(app).toHaveAttribute('data-game-status', 'paused');
  await page.keyboard.press('p');
  await expect(app).toHaveAttribute('data-game-status', 'running');
  await expect(app).toHaveAttribute('data-pause-intent-count', '4');

  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await page.clock.runFor(1_800);
  const result = page.getByRole('dialog', { name: 'Game over' });
  await expect(result).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(result).toBeVisible();
  await expect(app).toHaveAttribute('data-game-status', 'gameOver');
  await expect(app).toHaveAttribute('data-pause-intent-count', '4');
  expect(browserErrors).toEqual([]);
});

test('a queued turn survives pause and paused input cannot replace it', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);
  const app = page.locator('#app');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  await page.keyboard.press('ArrowUp');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.keyboard.press('ArrowLeft');
  await expect(app).toHaveAttribute('data-input-direction', 'left');
  await expect(app).toHaveAttribute('data-input-direction-count', '2');
  await page.clock.runFor(2_000);
  await expect(app).toHaveAttribute('data-game-head', '10,10');

  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.clock.runFor(179);
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await page.clock.runFor(1);
  await expect(app).toHaveAttribute('data-game-head', '10,9');
  expect(browserErrors).toEqual([]);
});

test('hidden and blur auto-pause idempotently without restoration or time catch-up', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);
  const app = page.locator('#app');
  const liveRegion = page.locator('[role="status"]');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(179);

  await dispatchVisibilityChange(page, true);
  await expect(app).toHaveAttribute('data-game-status', 'paused');
  await expect(liveRegion).toHaveText(
    'Game paused because the tab was hidden.',
  );
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(liveRegion).toHaveText(
    'Game paused because the tab was hidden.',
  );
  await page.clock.runFor(10_000);
  await expect(app).toHaveAttribute('data-game-head', '10,10');

  await dispatchVisibilityChange(page, false);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(app).toHaveAttribute('data-game-status', 'paused');
  await page.clock.runFor(1_000);
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.clock.runFor(179);
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await page.clock.runFor(1);
  await expect(app).toHaveAttribute('data-game-head', '11,10');

  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(app).toHaveAttribute('data-game-status', 'paused');
  await expect(liveRegion).toHaveText(
    'Game paused because the window lost focus.',
  );
  await dispatchVisibilityChange(page, true);
  await expect(liveRegion).toHaveText(
    'Game paused because the window lost focus.',
  );
  await dispatchVisibilityChange(page, false);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.runFor(5_000);
  await expect(app).toHaveAttribute('data-game-status', 'paused');
  await expect(app).toHaveAttribute('data-game-head', '11,10');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.clock.runFor(179);
  await expect(app).toHaveAttribute('data-game-head', '11,10');
  await page.clock.runFor(1);
  await expect(app).toHaveAttribute('data-game-head', '12,10');
  expect(browserErrors).toEqual([]);
});

test('settings alone leaves play running and paused controls fit at 320px', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await loadWithControlledClock(page);
  const app = page.locator('#app');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.clock.runFor(180);
  await expect(app).toHaveAttribute('data-game-status', 'running');
  await expect(app).toHaveAttribute('data-game-head', '11,10');
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Close settings' })
    .click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    pauseText: document.querySelector<HTMLButtonElement>(
      '[data-action="pause"]',
    )?.textContent,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.pauseText?.trim()).toBe('Resume');
  await page.screenshot({
    path: 'test-results/pause-safety-mobile-320.png',
    fullPage: true,
  });
  expect(browserErrors).toEqual([]);
});
