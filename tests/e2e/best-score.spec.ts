import { expect, test as playwrightTest, type Page } from '@playwright/test';

const test = (
  import.meta.env?.MODE === 'test' ? () => undefined : playwrightTest
) as typeof playwrightTest;

const CLOCK_INSTALL_TIME = new Date('2026-01-01T00:00:00.000Z');
const CLOCK_PAUSE_TIME = new Date('2026-01-01T00:01:00.000Z');
const BEST_SCORE_KEY = 'snakish.best-score.v1';

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

async function scoreTenAndReachTerminal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(720);
  await expect(page.getByTestId('score-value')).toHaveText('10');
  await expect(page.getByTestId('best-score-value')).toHaveText('10');
  await page.clock.runFor(1_080);
  await expect(page.locator('#app')).toHaveAttribute(
    'data-game-status',
    'gameOver',
  );
}

test('persists a first best immediately, reloads it, and hides New best on an equal mobile run', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);

  await expect(page.getByTestId('score-value')).toHaveText('0');
  await expect(page.getByTestId('best-score-value')).toHaveText('0');
  await scoreTenAndReachTerminal(page);

  const result = page.getByRole('dialog', { name: 'Game over' });
  await expect(result.getByTestId('new-best')).toBeVisible();
  await expect(
    result.getByRole('button', { name: 'Play again' }),
  ).toBeFocused();
  await expect(
    page.evaluate((key) => localStorage.getItem(key), BEST_SCORE_KEY),
  ).resolves.toBe(JSON.stringify({ version: 1, bestScore: 10 }));
  await page.screenshot({
    path: 'test-results/best-score-new-best-terminal.png',
    fullPage: true,
  });

  await page.reload();
  await expect(page.locator('#app')).toHaveAttribute(
    'data-game-status',
    'ready',
  );
  await expect(page.getByTestId('score-value')).toHaveText('0');
  await expect(page.getByTestId('best-score-value')).toHaveText('10');
  await page.screenshot({
    path: 'test-results/best-score-reloaded.png',
    fullPage: true,
  });

  const storedBeforeTie = await page.evaluate(
    (key) => localStorage.getItem(key),
    BEST_SCORE_KEY,
  );
  await page.setViewportSize({ width: 320, height: 720 });
  await scoreTenAndReachTerminal(page);
  const tiedResult = page.getByRole('dialog', { name: 'Game over' });
  await expect(tiedResult.getByTestId('new-best')).toBeHidden();
  await expect(page.getByTestId('best-score-value')).toHaveText('10');
  await expect(
    page.evaluate((key) => localStorage.getItem(key), BEST_SCORE_KEY),
  ).resolves.toBe(storedBeforeTie);

  const mobileLayout = await page.evaluate(() => {
    const scoreboard = document.querySelector<HTMLElement>('.scoreboard');
    const dialog = document.querySelector<HTMLElement>('#game-over-dialog');
    if (scoreboard === null || dialog === null) {
      throw new Error('Expected best-score layout elements.');
    }
    const scoreboardBounds = scoreboard.getBoundingClientRect();
    const dialogBounds = dialog.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      scoreboardLeft: scoreboardBounds.left,
      scoreboardRight: scoreboardBounds.right,
      dialogLeft: dialogBounds.left,
      dialogRight: dialogBounds.right,
    };
  });
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(
    mobileLayout.clientWidth,
  );
  expect(mobileLayout.scoreboardLeft).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.scoreboardRight).toBeLessThanOrEqual(
    mobileLayout.clientWidth,
  );
  expect(mobileLayout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(mobileLayout.dialogRight).toBeLessThanOrEqual(
    mobileLayout.clientWidth,
  );
  await page.screenshot({
    path: 'test-results/best-score-tie-mobile.png',
    fullPage: true,
  });
  expect(browserErrors).toEqual([]);
});

test('keeps a valid higher preseed without overwriting or New best treatment', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.addInitScript(
    ({ key, payload }) => localStorage.setItem(key, payload),
    {
      key: BEST_SCORE_KEY,
      payload: JSON.stringify({ version: 1, bestScore: 40 }),
    },
  );
  await loadWithControlledClock(page);

  await expect(page.getByTestId('best-score-value')).toHaveText('40');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(1_800);

  const result = page.getByRole('dialog', { name: 'Game over' });
  await expect(result.getByTestId('final-score-value')).toHaveText('10');
  await expect(result.getByTestId('new-best')).toBeHidden();
  await expect(page.getByTestId('best-score-value')).toHaveText('40');
  await expect(
    page.evaluate((key) => localStorage.getItem(key), BEST_SCORE_KEY),
  ).resolves.toBe(JSON.stringify({ version: 1, bestScore: 40 }));
  expect(browserErrors).toEqual([]);
});

test('fails closed on malformed storage and repairs it on the first score', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.addInitScript(
    (key) => localStorage.setItem(key, '{'),
    BEST_SCORE_KEY,
  );
  await loadWithControlledClock(page);

  await expect(page.getByTestId('best-score-value')).toHaveText('0');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(720);
  await expect(page.getByTestId('score-value')).toHaveText('10');
  await expect(page.getByTestId('best-score-value')).toHaveText('10');
  await expect(
    page.evaluate((key) => localStorage.getItem(key), BEST_SCORE_KEY),
  ).resolves.toBe(JSON.stringify({ version: 1, bestScore: 10 }));
  expect(browserErrors).toEqual([]);
});

for (const failureMode of ['getter', 'methods'] as const) {
  test(`continues fully in memory when localStorage ${failureMode} throw before app startup`, async ({
    page,
  }) => {
    const browserErrors = collectPageErrors(page);
    await page.addInitScript((mode) => {
      if (mode === 'getter') {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          get: () => {
            throw new Error('blocked');
          },
        });
        return;
      }

      Object.defineProperties(Storage.prototype, {
        getItem: {
          configurable: true,
          value: () => {
            throw new Error('blocked');
          },
        },
        setItem: {
          configurable: true,
          value: () => {
            throw new Error('blocked');
          },
        },
      });
    }, failureMode);
    await loadWithControlledClock(page);

    await expect(page.getByTestId('best-score-value')).toHaveText('0');
    await scoreTenAndReachTerminal(page);
    await expect(page.getByTestId('best-score-value')).toHaveText('10');
    await expect(
      page.getByRole('dialog', { name: 'Game over' }).getByTestId('new-best'),
    ).toBeVisible();
    expect(browserErrors).toEqual([]);
  });
}
