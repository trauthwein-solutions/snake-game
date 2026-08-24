import {
  expect,
  test as playwrightTest,
  type Locator,
  type Page,
} from '@playwright/test';

const test = (
  import.meta.env?.MODE === 'test' ? () => undefined : playwrightTest
) as typeof playwrightTest;

const CLOCK_INSTALL_TIME = new Date('2026-01-01T00:00:00.000Z');
const CLOCK_PAUSE_TIME = new Date('2026-01-01T00:01:00.000Z');
const PREFERENCES_KEY = 'snakish.preferences.v1';
const DEFAULT_PAYLOAD = {
  version: 1,
  music: true,
  soundEffects: true,
  reducedMotion: false,
  highContrast: false,
} as const;
const HIGH_CONTRAST_PRIMARY = {
  background: 'rgb(0, 255, 255)',
  border: 'rgb(0, 255, 255)',
  color: 'rgb(0, 0, 0)',
} as const;
const HIGH_CONTRAST_DISABLED = {
  background: 'rgb(36, 36, 36)',
  border: 'rgb(153, 153, 153)',
  color: 'rgb(187, 187, 187)',
} as const;

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function loadWithControlledClock(
  page: Page,
  reducedMotion: 'no-preference' | 'reduce' = 'no-preference',
): Promise<void> {
  await page.emulateMedia({ reducedMotion });
  await page.clock.install({ time: CLOCK_INSTALL_TIME });
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto('/');
  await page.clock.pauseAt(CLOCK_PAUSE_TIME);
}

function settingsControls(page: Page) {
  return {
    music: page.getByRole('checkbox', { name: 'Music', exact: true }),
    soundEffects: page.getByRole('checkbox', {
      name: 'Sound effects',
      exact: true,
    }),
    reducedMotion: page.getByRole('checkbox', {
      name: 'Reduced motion',
      exact: true,
    }),
    highContrast: page.getByRole('checkbox', {
      name: 'High contrast',
      exact: true,
    }),
  };
}

async function canvasSignature(page: Page): Promise<string> {
  return await page
    .getByRole('img', { name: 'SNAKISH game arena' })
    .evaluate((element) => (element as HTMLCanvasElement).toDataURL());
}

async function expectButtonColors(
  button: Locator,
  colors: {
    background: string;
    border: string;
    color: string;
  },
): Promise<void> {
  await expect(button).toHaveCSS('background-color', colors.background);
  await expect(button).toHaveCSS('border-color', colors.border);
  await expect(button).toHaveCSS('color', colors.color);
}

async function cyanGameActionCount(page: Page): Promise<number> {
  return await page
    .locator('.game-actions button')
    .evaluateAll(
      (buttons, cyan) =>
        buttons.filter(
          (button) => getComputedStyle(button).backgroundColor === cyan,
        ).length,
      HIGH_CONTRAST_PRIMARY.background,
    );
}

test('defaults, immediate high contrast, and reload persistence preserve game state', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);
  const app = page.locator('#app');
  const shell = page.locator('.app-shell');
  const settingsButton = page.getByRole('button', {
    name: 'Settings',
    exact: true,
  });
  await settingsButton.click();
  const controls = settingsControls(page);

  await expect(controls.music).toBeChecked();
  await expect(controls.soundEffects).toBeChecked();
  await expect(controls.reducedMotion).not.toBeChecked();
  await expect(controls.highContrast).not.toBeChecked();
  await page.screenshot({
    path: 'test-results/preferences-default-settings.png',
    fullPage: true,
  });

  const normalSignature = await canvasSignature(page);
  await controls.highContrast.check();
  await page.clock.runFor(20);
  await expect(app).toHaveAttribute('data-high-contrast', 'true');
  await expect(shell).toHaveAttribute('data-high-contrast', 'true');
  await expect(app).toHaveAttribute('data-game-status', 'ready');
  const highContrastSignature = await canvasSignature(page);
  expect(highContrastSignature).not.toBe(normalSignature);
  const styles = await page.evaluate(() => {
    const shellElement = document.querySelector<HTMLElement>('.app-shell');
    const dialog = document.querySelector<HTMLElement>('#settings-dialog');
    const score = document.querySelector<HTMLElement>('[data-score="current"]');
    if (shellElement === null || dialog === null || score === null) {
      throw new Error('Expected high-contrast UI elements.');
    }
    return {
      shellBackground: getComputedStyle(shellElement).backgroundColor,
      shellColor: getComputedStyle(shellElement).color,
      dialogBackground: getComputedStyle(dialog).backgroundColor,
      dialogBorder: getComputedStyle(dialog).borderColor,
      scoreColor: getComputedStyle(score).color,
      headingShadow: getComputedStyle(document.querySelector('h1')!).textShadow,
    };
  });
  expect(styles).toEqual({
    shellBackground: 'rgb(0, 0, 0)',
    shellColor: 'rgb(255, 255, 255)',
    dialogBackground: 'rgb(0, 0, 0)',
    dialogBorder: 'rgb(255, 255, 255)',
    scoreColor: 'rgb(255, 255, 0)',
    headingShadow: 'none',
  });
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.screenshot({
    path: 'test-results/preferences-high-contrast-ready.png',
    fullPage: true,
  });

  const playButton = page.getByRole('button', { name: 'Play', exact: true });
  const pauseButton = page.getByRole('button', {
    name: 'Pause',
    exact: true,
  });
  const restartButton = page.getByRole('button', {
    name: 'Restart',
    exact: true,
  });
  await expectButtonColors(playButton, HIGH_CONTRAST_PRIMARY);
  expect(await cyanGameActionCount(page)).toBe(1);

  await playButton.click();
  await page.clock.runFor(360);
  await expect(app).toHaveAttribute('data-game-status', 'running');
  await expect(playButton).toBeDisabled();
  await expect(pauseButton).toBeEnabled();
  await expectButtonColors(playButton, HIGH_CONTRAST_DISABLED);
  await expectButtonColors(pauseButton, HIGH_CONTRAST_PRIMARY);
  expect(await cyanGameActionCount(page)).toBe(1);

  await playButton.hover();
  await expectButtonColors(playButton, HIGH_CONTRAST_DISABLED);
  await expectButtonColors(pauseButton, HIGH_CONTRAST_PRIMARY);
  expect(await cyanGameActionCount(page)).toBe(1);
  await page.screenshot({
    path: 'test-results/preferences-high-contrast-gameplay.png',
    fullPage: true,
  });

  await expect(restartButton).toBeEnabled();
  await restartButton.hover();
  await expectButtonColors(restartButton, HIGH_CONTRAST_PRIMARY);
  await page.getByRole('img', { name: 'SNAKISH game arena' }).hover();
  expect(await cyanGameActionCount(page)).toBe(1);

  await pauseButton.click();
  await expect(app).toHaveAttribute('data-game-status', 'paused');
  await expectButtonColors(
    page.getByRole('button', { name: 'Resume', exact: true }),
    HIGH_CONTRAST_PRIMARY,
  );
  expect(await cyanGameActionCount(page)).toBe(1);

  await page.reload();
  await expect(app).toHaveAttribute('data-game-status', 'ready');
  await expect(app).toHaveAttribute('data-high-contrast', 'true');
  await settingsButton.click();
  await expect(settingsControls(page).highContrast).toBeChecked();
  await expect(
    page.evaluate((key) => localStorage.getItem(key), PREFERENCES_KEY),
  ).resolves.toBe(JSON.stringify({ ...DEFAULT_PAYLOAD, highContrast: true }));
  expect(browserErrors).toEqual([]);
});

test('stored and OS reduced motion synchronize the one presentation loop without stopping gameplay', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);
  const app = page.locator('#app');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(720);
  await expect(app).toHaveAttribute('data-game-head', '14,10');
  await expect(app).toHaveAttribute('data-game-score', '10');
  const animatedFeedback = await canvasSignature(page);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const reducedMotion = settingsControls(page).reducedMotion;
  await reducedMotion.check();
  await expect(app).toHaveAttribute('data-reduced-motion', 'true');
  const reducedFrame = await canvasSignature(page);
  expect(reducedFrame).not.toBe(animatedFeedback);
  await page.clock.runFor(100);
  expect(await canvasSignature(page)).toBe(reducedFrame);
  await page.screenshot({
    path: 'test-results/preferences-reduced-motion-settings.png',
    fullPage: true,
  });

  await page.clock.runFor(80);
  await expect(app).toHaveAttribute('data-game-head', '15,10');
  await expect(app).toHaveAttribute('data-game-status', 'running');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await reducedMotion.uncheck();
  await expect(reducedMotion).not.toBeChecked();
  await expect(app).toHaveAttribute('data-reduced-motion', 'true');
  const osReducedFrame = await canvasSignature(page);
  await page.clock.runFor(100);
  expect(await canvasSignature(page)).toBe(osReducedFrame);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(app).toHaveAttribute('data-reduced-motion', 'false');
  const resumedStart = await canvasSignature(page);
  await page.clock.runFor(40);
  expect(await canvasSignature(page)).not.toBe(resumedStart);
  await expect(app).toHaveAttribute('data-game-status', 'running');
  expect(browserErrors).toEqual([]);
});

test('music and sound-effects preferences persist independently without game-state effects', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);
  const app = page.locator('#app');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const controls = settingsControls(page);
  await controls.music.uncheck();
  await expect(app).toHaveAttribute('data-game-status', 'ready');
  await expect(controls.soundEffects).toBeChecked();
  await controls.soundEffects.uncheck();
  await expect(app).toHaveAttribute('data-game-status', 'ready');
  await page.reload();

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const reloaded = settingsControls(page);
  await expect(reloaded.music).not.toBeChecked();
  await expect(reloaded.soundEffects).not.toBeChecked();
  await expect(reloaded.reducedMotion).not.toBeChecked();
  await expect(reloaded.highContrast).not.toBeChecked();
  expect(browserErrors).toEqual([]);
});

for (const [label, invalidPayload] of [
  ['malformed', '{'],
  [
    'duplicate',
    '{"version":1,"music":false,"mu\\u0073ic":true,"soundEffects":false,"reducedMotion":true,"highContrast":true}',
  ],
] as const) {
  test(`${label} preferences fall back and the first change repairs one canonical payload`, async ({
    page,
  }) => {
    const browserErrors = collectPageErrors(page);
    await page.addInitScript(
      ({ key, payload }) => localStorage.setItem(key, payload),
      { key: PREFERENCES_KEY, payload: invalidPayload },
    );
    await loadWithControlledClock(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const controls = settingsControls(page);
    await expect(controls.music).toBeChecked();
    await expect(controls.soundEffects).toBeChecked();
    await expect(controls.reducedMotion).not.toBeChecked();
    await expect(controls.highContrast).not.toBeChecked();

    await controls.music.uncheck();
    await expect(
      page.evaluate((key) => localStorage.getItem(key), PREFERENCES_KEY),
    ).resolves.toBe(
      '{"version":1,"music":false,"soundEffects":true,"reducedMotion":false,"highContrast":false}',
    );
    expect(browserErrors).toEqual([]);
  });
}

for (const failureMode of ['getter', 'getItem', 'setItem'] as const) {
  test(`Settings and gameplay remain usable when localStorage ${failureMode} throws`, async ({
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
      Object.defineProperty(Storage.prototype, mode, {
        configurable: true,
        value: () => {
          throw new Error('blocked');
        },
      });
    }, failureMode);
    await loadWithControlledClock(page);
    const app = page.locator('#app');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const controls = settingsControls(page);
    await controls.music.uncheck();
    await controls.soundEffects.uncheck();
    await controls.reducedMotion.check();
    await controls.highContrast.check();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(controls.music).not.toBeChecked();
    await expect(controls.soundEffects).not.toBeChecked();
    await expect(controls.reducedMotion).toBeChecked();
    await expect(controls.highContrast).toBeChecked();
    await page.getByRole('button', { name: 'Close settings' }).click();

    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(app).toHaveAttribute('data-game-status', 'running');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(app).toHaveAttribute('data-game-status', 'paused');
    expect(browserErrors).toEqual([]);
  });
}

test('320px persisted mixed high-contrast Settings stay unclipped with 44px controls', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addInitScript(
    ({ key, payload }) => localStorage.setItem(key, payload),
    {
      key: PREFERENCES_KEY,
      payload:
        '{"version":1,"music":false,"soundEffects":true,"reducedMotion":true,"highContrast":true}',
    },
  );
  await loadWithControlledClock(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const controls = settingsControls(page);
  await expect(controls.music).not.toBeChecked();
  await expect(controls.soundEffects).toBeChecked();
  await expect(controls.reducedMotion).toBeChecked();
  await expect(controls.highContrast).toBeChecked();

  const layout = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('#settings-dialog');
    const settings = [...document.querySelectorAll<HTMLElement>('.setting')];
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        '#settings-dialog button, #settings-dialog input',
      ),
    ];
    if (dialog === null) throw new Error('Expected Settings dialog.');
    const dialogBounds = dialog.getBoundingClientRect();
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogLeft: dialogBounds.left,
      dialogRight: dialogBounds.right,
      controls: controls.map((control) => {
        const bounds = control.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      }),
      rows: settings.map((setting) => {
        const bounds = setting.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right };
      }),
    };
  });
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.dialogLeft).toBeGreaterThanOrEqual(0);
  expect(layout.dialogRight).toBeLessThanOrEqual(layout.clientWidth);
  for (const control of layout.controls) {
    expect(control.width).toBeGreaterThanOrEqual(44);
    expect(control.height).toBeGreaterThanOrEqual(44);
  }
  for (const row of layout.rows) {
    expect(row.left).toBeGreaterThanOrEqual(layout.dialogLeft);
    expect(row.right).toBeLessThanOrEqual(layout.dialogRight);
  }
  await page.screenshot({
    path: 'test-results/preferences-mixed-mobile-320.png',
    fullPage: true,
  });
  expect(browserErrors).toEqual([]);
});
