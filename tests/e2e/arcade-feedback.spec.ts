import { expect, test as playwrightTest, type Page } from '@playwright/test';

const test = (
  import.meta.env?.MODE === 'test' ? () => undefined : playwrightTest
) as typeof playwrightTest;

function sourceFixtureTest(
  title: string,
  body: (fixtures: { page: Page }) => Promise<void>,
): void {
  test(title, { tag: '@source-fixture' }, body);
}

const DIRECT_RENDERER_FIXTURE_TITLE =
  'direct renderer terminal and high-contrast signatures isolate each event';
const DIRECT_FOOD_FIXTURE_TITLE =
  'direct food fixtures isolate center and boundary sparks at app cell size';
const DIRECT_REDUCED_MOTION_FIXTURE_TITLE =
  'direct reduced-motion fixtures are pixel-identical with or without events';

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

async function loadWithControlledClock(
  page: Page,
  reducedMotion: 'no-preference' | 'reduce',
): Promise<void> {
  await page.emulateMedia({ reducedMotion });
  await page.clock.install({ time: CLOCK_INSTALL_TIME });
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await page.goto('/');
  await page.clock.pauseAt(CLOCK_PAUSE_TIME);
}

async function consumedCellSignature(page: Page): Promise<number> {
  return await page
    .getByRole('img', { name: 'SNAKISH game arena' })
    .evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('Expected a 2D arena context.');
      const cellSize = canvas.width / 20;
      const side = Math.round(cellSize * 3);
      const centerX = Math.round(14.5 * cellSize);
      const centerY = Math.round(10.5 * cellSize);
      const pixels = context.getImageData(
        Math.round(centerX - side / 2),
        Math.round(centerY - side / 2),
        side,
        side,
      ).data;
      let hash = 2_166_136_261;
      for (const channel of pixels) {
        hash = Math.imul(hash ^ channel, 16_777_619);
      }
      return hash >>> 0;
    });
}

async function canvasRegionSignature(
  page: Page,
  region: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
): Promise<number> {
  return await page
    .getByRole('img', { name: 'SNAKISH game arena' })
    .evaluate((element, normalizedRegion) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('Expected a 2D arena context.');
      const left = Math.floor(canvas.width * normalizedRegion.x);
      const top = Math.floor(canvas.height * normalizedRegion.y);
      const width = Math.max(
        1,
        Math.floor(canvas.width * normalizedRegion.width),
      );
      const height = Math.max(
        1,
        Math.floor(canvas.height * normalizedRegion.height),
      );
      const pixels = context.getImageData(left, top, width, height).data;
      let hash = 2_166_136_261;
      for (const channel of pixels) {
        hash = Math.imul(hash ^ channel, 16_777_619);
      }
      return hash >>> 0;
    }, region);
}

test('food feedback expires on RAF time while the scored game stays paused', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page, 'no-preference');
  const app = page.locator('#app');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(720);
  await expect(app).toHaveAttribute('data-game-score', '10');
  await expect(app).toHaveAttribute('data-game-head', '14,10');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(app).toHaveAttribute('data-game-status', 'paused');
  await page.clock.runFor(180);

  const feedbackSignature = await consumedCellSignature(page);
  await page.screenshot({
    path: 'test-results/arcade-feedback-food-burst.png',
    fullPage: true,
  });

  // Leave RAF-quantization slack beyond the 360ms calculation window.
  await page.clock.runFor(220);
  const expiredSignature = await consumedCellSignature(page);
  await page.clock.runFor(100);
  const stableNoFeedbackSignature = await consumedCellSignature(page);

  expect(expiredSignature).not.toBe(feedbackSignature);
  expect(stableNoFeedbackSignature).toBe(expiredSignature);
  await expect(app).toHaveAttribute('data-game-status', 'paused');
  await expect(app).toHaveAttribute('data-game-score', '10');
  await expect(page.locator('[data-announcer="game-status"]')).toHaveText(
    'Game paused.',
  );
  expect(browserErrors).toEqual([]);
});

test('reduced motion suppresses feedback pixels without suppressing score semantics', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page, 'reduce');
  const app = page.locator('#app');
  const canvas = page.getByRole('img', { name: 'SNAKISH game arena' });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(720);
  await expect(app).toHaveAttribute('data-game-score', '10');
  await expect(page.locator('[data-announcer="game-status"]')).toHaveText(
    'Score 10.',
  );
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const pausedPixels = await canvas.evaluate((element) =>
    (element as HTMLCanvasElement).toDataURL(),
  );

  await page.clock.runFor(500);

  expect(
    await canvas.evaluate((element) =>
      (element as HTMLCanvasElement).toDataURL(),
    ),
  ).toBe(pausedPixels);
  await expect(app).toHaveAttribute('data-game-status', 'paused');
  await expect(app).toHaveAttribute('data-game-score', '10');
  await page.screenshot({
    path: 'test-results/arcade-feedback-reduced-motion-app.png',
    fullPage: true,
  });
  expect(browserErrors).toEqual([]);
});

test('game over keeps its dialog state while terminal pixels expire to a stable frame', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page, 'no-preference');
  const app = page.locator('#app');
  await page.getByRole('button', { name: 'Play', exact: true }).click();

  await page.clock.runFor(1_800);

  const result = page.getByRole('dialog', { name: 'Game over' });
  const playAgain = result.getByRole('button', { name: 'Play again' });
  await expect(result).toBeVisible();
  await expect(playAgain).toBeFocused();
  await expect(app).toHaveAttribute('data-game-status', 'gameOver');
  await expect(app).toHaveAttribute('data-game-head', '19,10');
  await expect(app).toHaveAttribute('data-game-score', '10');

  await page.clock.runFor(100);
  const terminalSignature = await canvasRegionSignature(page, {
    x: 0.75,
    y: 0,
    width: 0.25,
    height: 0.25,
  });
  await page.screenshot({
    path: 'test-results/arcade-feedback-game-over-dialog.png',
    fullPage: true,
  });

  await page.clock.runFor(420);
  const expiredSignature = await canvasRegionSignature(page, {
    x: 0.75,
    y: 0,
    width: 0.25,
    height: 0.25,
  });
  await page.clock.runFor(100);
  const stableExpiredSignature = await canvasRegionSignature(page, {
    x: 0.75,
    y: 0,
    width: 0.25,
    height: 0.25,
  });

  expect(expiredSignature).not.toBe(terminalSignature);
  expect(stableExpiredSignature).toBe(expiredSignature);
  await expect(result).toBeVisible();
  await expect(playAgain).toBeFocused();
  await expect(app).toHaveAttribute('data-game-status', 'gameOver');
  await expect(app).toHaveAttribute('data-game-head', '19,10');
  await expect(app).toHaveAttribute('data-game-score', '10');
  expect(browserErrors).toEqual([]);
});

type FixtureConfiguration = {
  readonly label: string;
  readonly stateStatus: 'running' | 'gameOver' | 'completed';
  readonly headPosition: { readonly x: number; readonly y: number };
  readonly foodPosition: { readonly x: number; readonly y: number } | null;
  readonly colorMode: 'normal' | 'high-contrast';
  readonly reducedMotion: boolean;
  readonly foodFeedbackPosition: {
    readonly x: number;
    readonly y: number;
  } | null;
  readonly terminalFeedbackStatus: 'gameOver' | 'completed' | null;
};

async function renderDirectFixtures(
  page: Page,
  configurations: readonly FixtureConfiguration[],
): Promise<{
  readonly signatures: readonly string[];
  readonly cellSize: number;
  readonly fixtureCellSizes: readonly number[];
}> {
  return await page.evaluate(async (fixtureConfigurations) => {
    const rendererPath = '/src/rendering/canvas-renderer.ts';
    const enginePath = '/src/engine/game-engine.ts';
    const { renderGameFrame } = (await import(
      /* @vite-ignore */ rendererPath
    )) as typeof import('../../src/rendering/canvas-renderer');
    const { createInitialState } = (await import(
      /* @vite-ignore */ enginePath
    )) as typeof import('../../src/engine/game-engine');

    const appArena = document.querySelector<HTMLCanvasElement>(
      '[data-render-target="arena"]',
    );
    if (appArena === null) throw new Error('Expected the real app arena.');
    const appArenaBounds = appArena.getBoundingClientRect();
    const appArenaStyles = getComputedStyle(appArena);
    const arenaWidth =
      appArenaBounds.width -
      Number.parseFloat(appArenaStyles.borderLeftWidth) -
      Number.parseFloat(appArenaStyles.borderRightWidth) -
      Number.parseFloat(appArenaStyles.paddingLeft) -
      Number.parseFloat(appArenaStyles.paddingRight);
    const arenaHeight =
      appArenaBounds.height -
      Number.parseFloat(appArenaStyles.borderTopWidth) -
      Number.parseFloat(appArenaStyles.borderBottomWidth) -
      Number.parseFloat(appArenaStyles.paddingTop) -
      Number.parseFloat(appArenaStyles.paddingBottom);

    document.body.replaceChildren();
    document.body.style.margin = '0';
    document.body.style.padding = '24px';
    document.body.style.background = '#04080d';
    document.body.style.color = '#eafffb';
    document.body.style.fontFamily = 'system-ui, sans-serif';
    const fixtureGrid = document.createElement('main');
    fixtureGrid.id = 'arcade-feedback-fixtures';
    fixtureGrid.style.display = 'flex';
    fixtureGrid.style.flexWrap = 'wrap';
    fixtureGrid.style.gap = '24px';
    document.body.append(fixtureGrid);

    const signatures: string[] = [];
    const fixtureCellSizes: number[] = [];
    for (const configuration of fixtureConfigurations) {
      const fixture = document.createElement('section');
      fixture.style.display = 'grid';
      fixture.style.gap = '8px';
      const heading = document.createElement('h1');
      heading.style.margin = '0';
      heading.style.fontSize = '20px';
      heading.textContent = configuration.label;
      const canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', configuration.label);
      canvas.style.display = 'block';
      canvas.style.width = `${arenaWidth}px`;
      canvas.style.height = `${arenaHeight}px`;
      fixture.append(heading, canvas);
      fixtureGrid.append(fixture);

      const initial = createInitialState();
      const state = {
        ...initial,
        status: configuration.stateStatus,
        snake: [
          configuration.headPosition,
          {
            x: Math.min(19, configuration.headPosition.x + 1),
            y: configuration.headPosition.y,
          },
          {
            x: Math.min(19, configuration.headPosition.x + 2),
            y: configuration.headPosition.y,
          },
        ],
        food: configuration.foodPosition,
      };
      renderGameFrame(canvas, state, {
        colorMode: configuration.colorMode,
        devicePixelRatio: window.devicePixelRatio,
        reducedMotion: configuration.reducedMotion,
        timestampMs: 1_180,
        feedback: {
          food: configuration.foodFeedbackPosition
            ? {
                type: 'food',
                timestampMs: 1_000,
                position: configuration.foodFeedbackPosition,
              }
            : null,
          terminal: configuration.terminalFeedbackStatus
            ? {
                type: 'terminal',
                timestampMs: 1_000,
                status: configuration.terminalFeedbackStatus,
              }
            : null,
        },
      });
      signatures.push(canvas.toDataURL());
      fixtureCellSizes.push(canvas.getBoundingClientRect().width / 20);
    }
    return {
      signatures,
      cellSize: arenaWidth / 20,
      fixtureCellSizes,
    };
  }, configurations);
}

const TERMINAL_FIXTURE_STATE = {
  headPosition: { x: 10, y: 10 },
  foodPosition: { x: 4, y: 4 },
  reducedMotion: false,
} as const;

sourceFixtureTest(DIRECT_RENDERER_FIXTURE_TITLE, async ({ page }) => {
  const browserErrors = collectPageErrors(page);
  await page.goto('/');

  const { signatures } = await renderDirectFixtures(page, [
    {
      label: 'Normal game over feedback on',
      ...TERMINAL_FIXTURE_STATE,
      stateStatus: 'gameOver',
      colorMode: 'normal',
      foodFeedbackPosition: null,
      terminalFeedbackStatus: 'gameOver',
    },
    {
      label: 'Normal game over feedback off',
      ...TERMINAL_FIXTURE_STATE,
      stateStatus: 'gameOver',
      colorMode: 'normal',
      foodFeedbackPosition: null,
      terminalFeedbackStatus: null,
    },
    {
      label: 'Normal completed feedback on',
      ...TERMINAL_FIXTURE_STATE,
      stateStatus: 'completed',
      colorMode: 'normal',
      foodFeedbackPosition: null,
      terminalFeedbackStatus: 'completed',
    },
    {
      label: 'Normal completed feedback off',
      ...TERMINAL_FIXTURE_STATE,
      stateStatus: 'completed',
      colorMode: 'normal',
      foodFeedbackPosition: null,
      terminalFeedbackStatus: null,
    },
    {
      label: 'High contrast game over feedback on',
      ...TERMINAL_FIXTURE_STATE,
      stateStatus: 'gameOver',
      colorMode: 'high-contrast',
      foodFeedbackPosition: null,
      terminalFeedbackStatus: 'gameOver',
    },
    {
      label: 'High contrast game over feedback off',
      ...TERMINAL_FIXTURE_STATE,
      stateStatus: 'gameOver',
      colorMode: 'high-contrast',
      foodFeedbackPosition: null,
      terminalFeedbackStatus: null,
    },
    {
      label: 'High contrast completed feedback on',
      ...TERMINAL_FIXTURE_STATE,
      stateStatus: 'completed',
      colorMode: 'high-contrast',
      foodFeedbackPosition: null,
      terminalFeedbackStatus: 'completed',
    },
    {
      label: 'High contrast completed feedback off',
      ...TERMINAL_FIXTURE_STATE,
      stateStatus: 'completed',
      colorMode: 'high-contrast',
      foodFeedbackPosition: null,
      terminalFeedbackStatus: null,
    },
    {
      label: 'High contrast food feedback on',
      ...TERMINAL_FIXTURE_STATE,
      stateStatus: 'running',
      colorMode: 'high-contrast',
      foodFeedbackPosition: TERMINAL_FIXTURE_STATE.headPosition,
      terminalFeedbackStatus: null,
    },
    {
      label: 'High contrast food feedback off',
      ...TERMINAL_FIXTURE_STATE,
      stateStatus: 'running',
      colorMode: 'high-contrast',
      foodFeedbackPosition: null,
      terminalFeedbackStatus: null,
    },
  ]);
  const [
    normalGameOverOn,
    normalGameOverOff,
    normalCompletedOn,
    normalCompletedOff,
    highContrastGameOverOn,
    highContrastGameOverOff,
    highContrastCompletedOn,
    highContrastCompletedOff,
    highContrastFoodOn,
    highContrastFoodOff,
  ] = signatures;

  expect(normalGameOverOn).not.toBe(normalGameOverOff);
  expect(normalCompletedOn).not.toBe(normalCompletedOff);
  expect(highContrastGameOverOn).not.toBe(highContrastGameOverOff);
  expect(highContrastCompletedOn).not.toBe(highContrastCompletedOff);
  expect(highContrastFoodOn).not.toBe(highContrastFoodOff);
  expect(normalGameOverOn).not.toBe(normalCompletedOn);
  expect(highContrastGameOverOn).not.toBe(highContrastCompletedOn);

  await page
    .getByRole('img', { name: 'Normal game over feedback on' })
    .screenshot({ path: 'test-results/arcade-feedback-game-over.png' });
  await page
    .getByRole('img', { name: 'Normal completed feedback on' })
    .screenshot({ path: 'test-results/arcade-feedback-completed.png' });
  await page
    .getByRole('img', { name: 'High contrast food feedback on' })
    .screenshot({ path: 'test-results/arcade-feedback-high-contrast.png' });
  expect(browserErrors).toEqual([]);
});

sourceFixtureTest(DIRECT_FOOD_FIXTURE_TITLE, async ({ page }) => {
  const browserErrors = collectPageErrors(page);
  await page.goto('/');
  const positions = [
    ['center', { x: 10, y: 10 }],
    ['left edge', { x: 0, y: 10 }],
    ['top-left corner', { x: 0, y: 0 }],
  ] as const;
  const configurations: FixtureConfiguration[] = [];
  for (const [label, position] of positions) {
    configurations.push(
      {
        label: `${label} food feedback on`,
        stateStatus: 'running',
        headPosition: position,
        foodPosition: { x: 5, y: 5 },
        colorMode: 'normal',
        reducedMotion: false,
        foodFeedbackPosition: position,
        terminalFeedbackStatus: null,
      },
      {
        label: `${label} food feedback off`,
        stateStatus: 'running',
        headPosition: position,
        foodPosition: { x: 5, y: 5 },
        colorMode: 'normal',
        reducedMotion: false,
        foodFeedbackPosition: null,
        terminalFeedbackStatus: null,
      },
    );
  }
  const { signatures, cellSize, fixtureCellSizes } = await renderDirectFixtures(
    page,
    configurations,
  );
  expect(cellSize).toBeGreaterThan(0);
  for (const fixtureCellSize of fixtureCellSizes) {
    expect(fixtureCellSize).toBeCloseTo(cellSize, 5);
  }
  for (let index = 0; index < signatures.length; index += 2) {
    expect(signatures[index]).not.toBe(signatures[index + 1]);
  }
  await page.locator('#arcade-feedback-fixtures').screenshot({
    path: 'test-results/arcade-feedback-food-boundary-pairs.png',
  });
  for (const [label] of positions) {
    await page
      .getByRole('img', { name: `${label} food feedback on` })
      .screenshot({
        path: `test-results/arcade-feedback-food-${label.replaceAll(' ', '-')}.png`,
      });
  }
  expect(browserErrors).toEqual([]);
});

sourceFixtureTest(DIRECT_REDUCED_MOTION_FIXTURE_TITLE, async ({ page }) => {
  const browserErrors = collectPageErrors(page);
  await page.goto('/');
  const { signatures } = await renderDirectFixtures(page, [
    {
      label: 'Reduced motion with feedback events',
      ...TERMINAL_FIXTURE_STATE,
      stateStatus: 'completed',
      colorMode: 'normal',
      reducedMotion: true,
      foodFeedbackPosition: TERMINAL_FIXTURE_STATE.headPosition,
      terminalFeedbackStatus: 'completed',
    },
    {
      label: 'Reduced motion baseline without feedback',
      ...TERMINAL_FIXTURE_STATE,
      stateStatus: 'completed',
      colorMode: 'normal',
      reducedMotion: true,
      foodFeedbackPosition: null,
      terminalFeedbackStatus: null,
    },
  ]);
  const [withEvents, baseline] = signatures;

  expect(withEvents).toBe(baseline);
  await page.locator('#arcade-feedback-fixtures').screenshot({
    path: 'test-results/arcade-feedback-reduced-motion-no-effect.png',
  });
  expect(browserErrors).toEqual([]);
});
