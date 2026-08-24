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

test('plays a complete desktop lifecycle on the fixed-step clock', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);

  const app = page.locator('#app');
  const play = page.getByRole('button', { name: 'Play', exact: true });
  await expect(app).toHaveAttribute('data-game-status', 'ready');
  await expect(app).toHaveAttribute('data-game-score', '0');
  await expect(app).toHaveAttribute('data-game-head', '10,10');

  await play.click();
  await expect(app).toHaveAttribute('data-game-status', 'running');
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await page.clock.runFor(179);
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await page.clock.runFor(1);
  await expect(app).toHaveAttribute('data-game-head', '11,10');

  await page.keyboard.press('ArrowUp');
  await expect(app).toHaveAttribute('data-game-head', '11,10');
  await page.clock.runFor(180);
  await expect(app).toHaveAttribute('data-game-head', '11,9');

  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await page.clock.runFor(179);
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await page.clock.runFor(1);
  await expect(app).toHaveAttribute('data-game-head', '11,10');
  await page.clock.runFor(539);
  await expect(app).toHaveAttribute('data-game-score', '0');
  await page.clock.runFor(1);
  await expect(app).toHaveAttribute('data-game-score', '10');
  await expect(page.getByTestId('score-value')).toHaveText('10');
  await expect(app).toHaveAttribute('data-game-head', '14,10');

  await page.screenshot({
    path: 'test-results/gameplay-desktop.png',
    fullPage: true,
  });

  await page.clock.runFor(1_080);
  await expect(app).toHaveAttribute('data-game-status', 'gameOver');
  await expect(app).toHaveAttribute('data-game-head', '19,10');
  const result = page.getByRole('dialog', { name: 'Game over' });
  await expect(result).toBeVisible();
  await expect(result.getByTestId('final-score-value')).toHaveText('10');
  await expect(
    result.getByRole('button', { name: 'Play again' }),
  ).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(result).toBeVisible();
  await expect(
    result.getByRole('button', { name: 'Play again' }),
  ).toBeFocused();
  await expect(app).toHaveAttribute('data-game-status', 'gameOver');
  await expect(app).toHaveAttribute('data-game-head', '19,10');

  await page.clock.runFor(1_000);
  await expect(result).toBeVisible();
  await expect(app).toHaveAttribute('data-game-status', 'gameOver');
  await expect(app).toHaveAttribute('data-game-head', '19,10');

  await result.getByRole('button', { name: 'Play again' }).click();
  await expect(app).toHaveAttribute('data-game-status', 'running');
  await expect(app).toHaveAttribute('data-game-score', '0');
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await page.clock.runFor(179);
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await page.clock.runFor(1);
  await expect(app).toHaveAttribute('data-game-head', '11,10');

  await page.clock.runFor(1_620);
  await expect(app).toHaveAttribute('data-game-status', 'gameOver');
  await page.getByRole('button', { name: 'Return to title' }).click();
  await expect(app).toHaveAttribute('data-game-status', 'ready');
  await expect(app).toHaveAttribute('data-game-score', '0');
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await expect(play).toBeFocused();
  await expect(
    page.getByRole('dialog', { name: 'Game over', includeHidden: true }),
  ).toBeHidden();
  expect(browserErrors).toEqual([]);
});

test('closes running-game settings before showing the terminal result', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await loadWithControlledClock(page);

  const app = page.locator('#app');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const result = page.getByRole('dialog', { name: 'Game over' });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(settings).toBeVisible();

  await page.clock.runFor(180);
  await expect(app).toHaveAttribute('data-game-status', 'running');
  await expect(app).toHaveAttribute('data-game-head', '11,10');
  await expect(settings).toBeVisible();

  await page.clock.runFor(1_620);
  await expect(app).toHaveAttribute('data-game-status', 'gameOver');
  await expect(settings).toBeHidden();
  await expect(page.locator('#settings-dialog')).not.toHaveAttribute(
    'open',
    '',
  );
  await expect(result).toBeVisible();
  await expect(page.locator('dialog:visible')).toHaveCount(1);
  await expect(
    result.getByRole('button', { name: 'Play again' }),
  ).toBeFocused();

  await result.getByRole('button', { name: 'Play again' }).click();
  await expect(app).toHaveAttribute('data-game-status', 'running');
  await expect(app).toHaveAttribute('data-game-head', '10,10');
  await expect(result).toBeHidden();
  await expect(settings).toBeHidden();
  await page.clock.runFor(180);
  await expect(app).toHaveAttribute('data-game-head', '11,10');
  expect(browserErrors).toEqual([]);
});

test('shows and tears down the actual completed-result dialog helper', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.goto('/');

  await page.evaluate(async () => {
    const modulePath = '/src/ui/dialogs.ts';
    const { createDialogs } = (await import(/* @vite-ignore */ modulePath)) as {
      createDialogs: (settingsButton: HTMLButtonElement) => {
        settingsDialog: HTMLDialogElement;
        gameOverDialog: HTMLDialogElement;
        showResult: (status: 'gameOver' | 'completed', score: number) => void;
        closeResult: () => void;
        closeSettings: () => void;
        teardown: () => void;
      };
    };
    document.body.replaceChildren();
    const fixture = document.createElement('section');
    fixture.id = 'completed-dialog-fixture';
    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.textContent = 'Fixture settings';
    const dialogs = createDialogs(settingsButton);
    fixture.append(
      settingsButton,
      dialogs.settingsDialog,
      dialogs.gameOverDialog,
    );
    document.body.append(fixture);

    type DialogEvidenceWindow = typeof window & {
      __snakishDialogEvidence?: {
        cleanup: () => void;
        closeResult: () => void;
        dispatchCancelableCancel: () => boolean;
        teardown: () => void;
      };
    };
    const evidenceWindow = window as DialogEvidenceWindow;
    evidenceWindow.__snakishDialogEvidence = {
      closeResult: dialogs.closeResult,
      dispatchCancelableCancel: () => {
        const event = new Event('cancel', { cancelable: true });
        dialogs.gameOverDialog.dispatchEvent(event);
        return event.defaultPrevented;
      },
      teardown: dialogs.teardown,
      cleanup: () => {
        dialogs.closeResult();
        dialogs.closeSettings();
        dialogs.teardown();
        fixture.remove();
        delete evidenceWindow.__snakishDialogEvidence;
      },
    };
    dialogs.showResult('completed', 400);
  });

  const fixture = page.locator('#completed-dialog-fixture');
  const result = fixture.getByRole('dialog', { name: 'Grid complete' });
  await expect(result).toBeVisible();
  await expect(result).toHaveAccessibleName('Grid complete');
  await expect(
    result.getByRole('heading', { name: 'Grid complete' }),
  ).toBeVisible();
  await expect(result.getByTestId('final-score-value')).toHaveText('400');
  await expect(
    result.getByRole('button', { name: 'Play again' }),
  ).toBeFocused();
  await expect(
    page.evaluate(() => {
      const evidenceWindow = window as typeof window & {
        __snakishDialogEvidence?: {
          dispatchCancelableCancel: () => boolean;
        };
      };
      return evidenceWindow.__snakishDialogEvidence?.dispatchCancelableCancel();
    }),
  ).resolves.toBe(true);

  await page.evaluate(() => {
    const evidenceWindow = window as typeof window & {
      __snakishDialogEvidence?: { closeResult: () => void };
    };
    evidenceWindow.__snakishDialogEvidence?.closeResult();
  });
  await expect(result).toBeHidden();

  const settingsButton = fixture.getByRole('button', {
    name: 'Fixture settings',
  });
  const settingsDialog = fixture.getByRole('dialog', { name: 'Settings' });
  await settingsButton.click();
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole('button', { name: 'Close settings' }).click();
  await expect(settingsDialog).toBeHidden();

  await page.evaluate(() => {
    const evidenceWindow = window as typeof window & {
      __snakishDialogEvidence?: {
        dispatchCancelableCancel: () => boolean;
        teardown: () => void;
      };
    };
    evidenceWindow.__snakishDialogEvidence?.teardown();
    document
      .querySelector<HTMLButtonElement>('#completed-dialog-fixture > button')
      ?.click();
  });
  await expect(fixture.locator('#settings-dialog')).not.toHaveAttribute(
    'open',
    '',
  );
  await expect(
    page.evaluate(() => {
      const evidenceWindow = window as typeof window & {
        __snakishDialogEvidence?: {
          dispatchCancelableCancel: () => boolean;
        };
      };
      return evidenceWindow.__snakishDialogEvidence?.dispatchCancelableCancel();
    }),
  ).resolves.toBe(false);

  await page.evaluate(() => {
    const evidenceWindow = window as typeof window & {
      __snakishDialogEvidence?: { cleanup: () => void };
    };
    evidenceWindow.__snakishDialogEvidence?.cleanup();
  });
  await expect(fixture).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});

test('started gameplay fits at 320px without overflow or overlap', async ({
  page,
}) => {
  const browserErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await loadWithControlledClock(page);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.clock.runFor(180);

  const layout = await page.evaluate(() => {
    const arena = document.querySelector<HTMLElement>('.arena-frame');
    const dpad = document.querySelector<HTMLElement>('.dpad');
    const actions = document.querySelector<HTMLElement>('.game-actions');
    if (arena === null || dpad === null || actions === null) {
      throw new Error('Expected gameplay layout elements.');
    }
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      arenaBottom: arena.getBoundingClientRect().bottom,
      dpadTop: dpad.getBoundingClientRect().top,
      dpadBottom: dpad.getBoundingClientRect().bottom,
      actionsTop: actions.getBoundingClientRect().top,
    };
  });

  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
  expect(layout.arenaBottom).toBeLessThan(layout.dpadTop);
  expect(layout.dpadBottom).toBeLessThan(layout.actionsTop);
  await page.screenshot({
    path: 'test-results/gameplay-mobile-320.png',
    fullPage: true,
  });
  expect(browserErrors).toEqual([]);
});
