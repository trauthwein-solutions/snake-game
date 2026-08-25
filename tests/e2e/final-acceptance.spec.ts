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

async function tabToControl(page: Page, accessibleName: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.keyboard.press('Tab');
    const focusedName = await page.evaluate(
      () =>
        document.activeElement?.getAttribute('aria-label') ??
        document.activeElement?.textContent?.trim(),
    );
    if (focusedName === accessibleName) return;
  }
  throw new Error(`Could not reach ${accessibleName} using Tab.`);
}

test('exposes concise nonvisual arena, score, settings, and result semantics', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);

  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SNAKISH');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

  const arena = page.getByRole('img', { name: 'SNAKISH game arena' });
  await expect(arena).toHaveAccessibleDescription(
    'Guide the snake to food. Wall or body collisions end the run. Use arrow keys or WASD, swipe the arena, or use the D-pad. Press P to pause or resume.',
  );
  await expect(page.getByText('Score', { exact: true })).toBeVisible();
  await expect(page.getByText('Best score', { exact: true })).toBeVisible();
  const scoreboardItems = page.locator('.scoreboard__item');
  await expect(scoreboardItems.nth(0).locator('dt')).toHaveText('Score');
  await expect(scoreboardItems.nth(0).locator('dd')).toHaveText('0');
  await expect(scoreboardItems.nth(1).locator('dt')).toHaveText('Best score');
  await expect(scoreboardItems.nth(1).locator('dd')).toHaveText('0');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toHaveAccessibleDescription(
    'Choose audio and visual preferences.',
  );
  await settings.getByRole('button', { name: 'Close settings' }).click();

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(1_800);
  const result = page.getByRole('dialog', { name: 'Game over' });
  await expect(result).toHaveAccessibleDescription('Final score 10 New best!');
  expect(browserErrors).toEqual([]);
});

test('completes a full lifecycle using only keyboard input with intentional focus', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);
  const app = page.locator('#app');

  await tabToControl(page, 'Settings');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('checkbox', { name: 'Music' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeFocused();

  await tabToControl(page, 'Play');
  await page.keyboard.press('Enter');
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  await expect(pause).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('Game started.');
  await page.keyboard.press('w');
  await page.clock.runFor(180);
  await expect(app).toHaveAttribute('data-game-head', '10,9');

  await page.keyboard.press('p');
  await expect(app).toHaveAttribute('data-game-status', 'paused');
  await expect(page.getByRole('button', { name: 'Resume' })).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('Game paused.');
  await page.keyboard.press('P');
  await expect(app).toHaveAttribute('data-game-status', 'running');
  await expect(pause).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('Game resumed.');

  await page.keyboard.press('Tab');
  const restart = page.getByRole('button', { name: 'Restart', exact: true });
  await expect(restart).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await expect(pause).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('Game restarted.');

  await page.keyboard.press('ArrowUp');
  await page.clock.runFor(180);
  await expect(app).toHaveAttribute('data-game-head', '10,9');
  await page.keyboard.press('ArrowRight');
  await page.clock.runFor(1_800);
  const result = page.getByRole('dialog', { name: 'Game over' });
  const playAgain = result.getByRole('button', { name: 'Play again' });
  await expect(playAgain).toBeFocused();
  await expect(page.getByRole('status')).toHaveText(
    'Game over. Final score 0.',
  );
  await page.keyboard.press('Escape');
  await expect(result).toBeVisible();
  await expect(playAgain).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(app).toHaveAttribute('data-game-status', 'running');
  await expect(pause).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('Game restarted.');
  await page.clock.runFor(1_800);
  await expect(result).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(
    result.getByRole('button', { name: 'Return to title' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(app).toHaveAttribute('data-game-status', 'ready');
  await expect(page.getByRole('button', { name: 'Play' })).toBeFocused();
  await expect(page.getByRole('status')).toHaveText('Returned to title.');
  expect(browserErrors).toEqual([]);
});

test('fits and preserves controls and focus across phone orientation changes', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 667, height: 375 });
  await loadWithControlledClock(page);

  const settingsTrigger = page.getByRole('button', { name: 'Settings' });
  await settingsTrigger.click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const landscape = await page.evaluate(() => {
    const dialog =
      document.querySelector<HTMLDialogElement>('#settings-dialog');
    if (dialog === null) throw new Error('Expected Settings dialog.');
    const bounds = dialog.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogLeft: bounds.left,
      dialogRight: bounds.right,
      dialogTop: bounds.top,
      dialogBottom: bounds.bottom,
      clientHeight: document.documentElement.clientHeight,
    };
  });
  expect(landscape.scrollWidth).toBeLessThanOrEqual(landscape.clientWidth);
  expect(landscape.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(landscape.dialogRight).toBeLessThanOrEqual(landscape.clientWidth);
  expect(landscape.dialogTop).toBeGreaterThanOrEqual(0);
  expect(landscape.dialogBottom).toBeLessThanOrEqual(landscape.clientHeight);
  await settings.getByRole('button', { name: 'Close settings' }).click();
  await expect(settingsTrigger).toBeFocused();

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.keyboard.press('ArrowUp');
  await page.clock.runFor(180);
  const landscapeGame = await page.evaluate(() => {
    const arena = document.querySelector<HTMLElement>('.arena-frame');
    const canvas = document.querySelector<HTMLCanvasElement>('.arena-canvas');
    const dpad = document.querySelector<HTMLElement>('.dpad');
    const actions = document.querySelector<HTMLElement>('.game-actions');
    if (
      arena === null ||
      canvas === null ||
      dpad === null ||
      actions === null
    ) {
      throw new Error('Expected landscape gameplay controls.');
    }
    const arenaBounds = arena.getBoundingClientRect();
    const canvasBounds = canvas.getBoundingClientRect();
    const dpadBounds = dpad.getBoundingClientRect();
    const actionBounds = actions.getBoundingClientRect();
    return {
      head: document.querySelector<HTMLElement>('#app')?.dataset.gameHead,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      arenaLeft: arenaBounds.left,
      arenaRight: arenaBounds.right,
      arenaBottom: arenaBounds.bottom,
      canvasWidth: canvasBounds.width,
      canvasHeight: canvasBounds.height,
      dpadTop: dpadBounds.top,
      dpadBottom: dpadBounds.bottom,
      actionsTop: actionBounds.top,
      targets: [
        ...document.querySelectorAll<HTMLElement>(
          '.dpad button, .game-actions button',
        ),
      ].map((control) => {
        const target = control.getBoundingClientRect();
        return { width: target.width, height: target.height };
      }),
    };
  });
  expect(landscapeGame.head).toBe('10,9');
  expect(landscapeGame.scrollWidth).toBeLessThanOrEqual(
    landscapeGame.clientWidth,
  );
  expect(landscapeGame.arenaLeft).toBeGreaterThanOrEqual(0);
  expect(landscapeGame.arenaRight).toBeLessThanOrEqual(
    landscapeGame.clientWidth,
  );
  expect(landscapeGame.canvasWidth).toBe(landscapeGame.canvasHeight);
  expect(landscapeGame.arenaBottom).toBeLessThan(landscapeGame.dpadTop);
  expect(landscapeGame.dpadBottom).toBeLessThan(landscapeGame.actionsTop);
  for (const target of landscapeGame.targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }

  await page.setViewportSize({ width: 320, height: 720 });
  const portrait = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('.arena-canvas');
    if (canvas === null) throw new Error('Expected game canvas.');
    const bounds = canvas.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      canvasWidth: bounds.width,
      canvasHeight: bounds.height,
      targets: [...document.querySelectorAll<HTMLElement>('.dpad button')].map(
        (button) => {
          const target = button.getBoundingClientRect();
          return { width: target.width, height: target.height };
        },
      ),
    };
  });
  expect(portrait.scrollWidth).toBeLessThanOrEqual(portrait.clientWidth);
  expect(portrait.canvasWidth).toBe(portrait.canvasHeight);
  for (const target of portrait.targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByRole('button', { name: 'Pause' })).toBeFocused();
  expect(browserErrors).toEqual([]);
});
