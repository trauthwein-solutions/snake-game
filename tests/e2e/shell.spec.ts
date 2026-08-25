import { expect, test as playwrightTest, type Page } from '@playwright/test';

const test = (
  import.meta.env?.MODE === 'test' ? () => undefined : playwrightTest
) as typeof playwrightTest;

function failOnPageErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
    }
  });

  return errors;
}

test('presents the accessible game shell without browser errors', async ({
  page,
}) => {
  const browserErrors = failOnPageErrors(page);

  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SNAKISH');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByText('Enter the grid.')).toBeVisible();

  await expect(page.getByText('Score', { exact: true })).toBeVisible();
  await expect(page.getByText('Best score', { exact: true })).toBeVisible();
  await expect(page.getByTestId('score-value')).toHaveText('0');
  await expect(page.getByTestId('best-score-value')).toHaveText('0');

  const arena = page.getByRole('img', { name: 'SNAKISH game arena' });
  await expect(arena).toBeVisible();
  await expect(arena).toHaveAttribute('aria-describedby', 'arena-instructions');
  await expect(page.locator('#arena-instructions')).toContainText(
    'Guide the snake to food.',
  );

  for (const name of ['Play', 'Pause', 'Restart', 'Settings']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(
      1,
    );
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }

  const liveRegion = page.getByRole('status');
  await expect(liveRegion).toHaveAttribute('aria-live', 'polite');
  await expect(liveRegion).toBeEmpty();
  expect(browserErrors).toEqual([]);

  await page.screenshot({
    path: 'test-results/shell-desktop.png',
    fullPage: true,
  });
});

test('settings dialog has labeled controls and restores focus when closed', async ({
  page,
}) => {
  const browserErrors = failOnPageErrors(page);
  await page.goto('/');

  const settingsButton = page.getByRole('button', {
    name: 'Settings',
    exact: true,
  });
  const closedSettingsDialog = page.getByRole('dialog', {
    name: 'Settings',
    includeHidden: true,
  });
  await expect(closedSettingsDialog).toBeHidden();
  await expect(closedSettingsDialog).not.toHaveAttribute('open', '');
  await settingsButton.focus();
  await settingsButton.click();

  const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(settingsDialog).toBeVisible();

  const controls = [
    page.getByRole('checkbox', { name: 'Music', exact: true }),
    page.getByRole('checkbox', { name: 'Sound effects', exact: true }),
    page.getByRole('checkbox', { name: 'Reduced motion', exact: true }),
    page.getByRole('checkbox', { name: 'High contrast', exact: true }),
  ];
  const musicStyle = page.getByRole('combobox', { name: 'Music style' });

  for (const control of controls) {
    await expect(control).toHaveCount(1);
    await expect(control).toBeVisible();
  }
  await expect(controls[0]).toBeFocused();
  await expect(musicStyle).toHaveValue('neonPulse');
  await expect(musicStyle.locator('option')).toHaveText([
    'Neon Pulse',
    'Pixel Drift',
    'Minimal Beat',
    'Chill Grid',
  ]);

  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(settingsDialog).toBeHidden();
  await expect(settingsButton).toBeFocused();
  expect(browserErrors).toEqual([]);
});

test('game-over dialog is initially closed and exposes its result actions', async ({
  page,
}) => {
  const browserErrors = failOnPageErrors(page);
  await page.goto('/');

  const gameOverDialog = page.locator('#game-over-dialog');
  await expect(
    page.getByRole('dialog', { name: 'Game over', includeHidden: true }),
  ).toHaveCount(1);
  await expect(gameOverDialog).not.toHaveAttribute('open', '');
  await expect(gameOverDialog).toBeHidden();
  await expect(gameOverDialog.getByText('Final score')).toHaveCount(1);
  await expect(gameOverDialog.getByTestId('final-score-value')).toHaveText('0');
  await expect(gameOverDialog.getByTestId('new-best')).toHaveAttribute(
    'hidden',
    '',
  );
  await expect(
    gameOverDialog.getByRole('button', {
      name: 'Play again',
      includeHidden: true,
    }),
  ).toHaveCount(1);
  await expect(
    gameOverDialog.getByRole('button', {
      name: 'Back to start',
      includeHidden: true,
    }),
  ).toHaveCount(1);
  expect(browserErrors).toEqual([]);
});

test('interactive controls meet touch target minimums', async ({ page }) => {
  const browserErrors = failOnPageErrors(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();

  const controls = page.locator(
    'button:visible, input[type="checkbox"]:visible, select:visible',
  );
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const control = controls.nth(index);
    const box = await control.boundingBox();
    const name = await control.getAttribute('aria-label');
    expect(box, `${name ?? `control ${index + 1}`} has a box`).not.toBeNull();
    expect(
      box?.width,
      `${name ?? `control ${index + 1}`} width`,
    ).toBeGreaterThanOrEqual(44);
    expect(
      box?.height,
      `${name ?? `control ${index + 1}`} height`,
    ).toBeGreaterThanOrEqual(44);
  }
  expect(browserErrors).toEqual([]);
});

test('fits the shell at 320 CSS pixels without horizontal overflow', async ({
  page,
}) => {
  const browserErrors = failOnPageErrors(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');

  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'SNAKISH game arena' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Play', exact: true }),
  ).toBeVisible();
  expect(browserErrors).toEqual([]);

  await page.screenshot({
    path: 'test-results/shell-mobile-320.png',
    fullPage: true,
  });
});
