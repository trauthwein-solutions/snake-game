import type { GameStatus } from '../engine/model';
import type { Preferences } from '../storage/preferences';

export interface SettingsControls {
  readonly music: HTMLInputElement;
  readonly soundEffects: HTMLInputElement;
  readonly reducedMotion: HTMLInputElement;
  readonly highContrast: HTMLInputElement;
}

interface GameDialogs {
  settingsDialog: HTMLDialogElement;
  gameOverDialog: HTMLDialogElement;
  playAgainButton: HTMLButtonElement;
  returnToTitleButton: HTMLButtonElement;
  settingsControls: SettingsControls;
  showResult(
    status: Extract<GameStatus, 'gameOver' | 'completed'>,
    score: number,
    isNewBest: boolean,
  ): void;
  closeSettings(): void;
  closeResult(): void;
  teardown(): void;
}

function createSetting(name: string, checked = false): string {
  const id = `setting-${name.toLowerCase().replaceAll(' ', '-')}`;

  return `
    <label class="setting" for="${id}">
      <span>${name}</span>
      <input id="${id}" name="${id}" type="checkbox" ${checked ? 'checked' : ''}>
    </label>
  `;
}

function createSettingsDialog(
  settingsButton: HTMLButtonElement,
  initialSettings: Preferences,
): {
  dialog: HTMLDialogElement;
  controls: SettingsControls;
  teardown: () => void;
} {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog-card';
  dialog.id = 'settings-dialog';
  dialog.setAttribute('aria-labelledby', 'settings-title');
  dialog.setAttribute('aria-describedby', 'settings-description');
  dialog.innerHTML = `
    <div class="dialog-heading">
      <div>
        <p class="dialog-kicker">Tune your run</p>
        <h2 id="settings-title">Settings</h2>
      </div>
      <button class="icon-button" type="button" aria-label="Close settings">×</button>
    </div>
    <p class="visually-hidden" id="settings-description">
      Choose audio and visual preferences.
    </p>
    <div class="settings-list">
      ${createSetting('Music', initialSettings.music)}
      ${createSetting('Sound effects', initialSettings.soundEffects)}
      ${createSetting('Reduced motion', initialSettings.reducedMotion)}
      ${createSetting('High contrast', initialSettings.highContrast)}
    </div>
  `;

  const closeButton = dialog.querySelector<HTMLButtonElement>('.icon-button');
  const music = dialog.querySelector<HTMLInputElement>('#setting-music');
  const soundEffects = dialog.querySelector<HTMLInputElement>(
    '#setting-sound-effects',
  );
  const reducedMotion = dialog.querySelector<HTMLInputElement>(
    '#setting-reduced-motion',
  );
  const highContrast = dialog.querySelector<HTMLInputElement>(
    '#setting-high-contrast',
  );

  if (
    closeButton === null ||
    music === null ||
    soundEffects === null ||
    reducedMotion === null ||
    highContrast === null
  ) {
    throw new Error('Settings dialog controls could not be created.');
  }

  const controls: SettingsControls = {
    music,
    soundEffects,
    reducedMotion,
    highContrast,
  };

  controls.music.checked = initialSettings.music;
  controls.soundEffects.checked = initialSettings.soundEffects;
  controls.reducedMotion.checked = initialSettings.reducedMotion;
  controls.highContrast.checked = initialSettings.highContrast;

  const openSettings = (): void => {
    dialog.showModal();
    controls.music.focus();
  };
  const closeSettings = (): void => dialog.close();
  const restoreSettingsFocus = (): void => settingsButton.focus();

  settingsButton.addEventListener('click', openSettings);
  closeButton.addEventListener('click', closeSettings);
  dialog.addEventListener('close', restoreSettingsFocus);

  return {
    dialog,
    controls,
    teardown: () => {
      settingsButton.removeEventListener('click', openSettings);
      closeButton.removeEventListener('click', closeSettings);
      dialog.removeEventListener('close', restoreSettingsFocus);
    },
  };
}

function createGameOverDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog-card dialog-card--game-over';
  dialog.id = 'game-over-dialog';
  dialog.setAttribute('aria-labelledby', 'game-over-title');
  dialog.setAttribute('aria-describedby', 'result-summary');
  dialog.innerHTML = `
    <p class="dialog-kicker">Run complete</p>
    <h2 id="game-over-title">Game over</h2>
    <p class="final-score" id="result-summary">
      <span>Final score</span>
      <strong data-testid="final-score-value" data-score="final">0</strong>
    </p>
    <p class="new-best" id="result-best" data-testid="new-best" data-new-best hidden>New best!</p>
    <div class="dialog-actions">
      <button class="button button--primary" type="button" data-action="play-again">
        Play again
      </button>
      <button class="button" type="button" data-action="return-to-title">
        Back to start
      </button>
    </div>
  `;

  return dialog;
}

export function createDialogs(
  settingsButton: HTMLButtonElement,
  initialSettings: Preferences,
): GameDialogs {
  const settings = createSettingsDialog(settingsButton, initialSettings);
  const gameOverDialog = createGameOverDialog();
  const resultTitle =
    gameOverDialog.querySelector<HTMLElement>('#game-over-title');
  const finalScore = gameOverDialog.querySelector<HTMLElement>(
    '[data-score="final"]',
  );
  const newBest = gameOverDialog.querySelector<HTMLElement>('[data-new-best]');
  const playAgainButton = gameOverDialog.querySelector<HTMLButtonElement>(
    '[data-action="play-again"]',
  );
  const returnToTitleButton = gameOverDialog.querySelector<HTMLButtonElement>(
    '[data-action="return-to-title"]',
  );

  if (
    resultTitle === null ||
    finalScore === null ||
    newBest === null ||
    playAgainButton === null ||
    returnToTitleButton === null
  ) {
    throw new Error('SNAKISH result dialog controls could not be created.');
  }

  const preventResultCancel = (event: Event): void => {
    event.preventDefault();
  };
  gameOverDialog.addEventListener('cancel', preventResultCancel);

  return {
    settingsDialog: settings.dialog,
    gameOverDialog,
    playAgainButton,
    returnToTitleButton,
    settingsControls: settings.controls,
    showResult: (status, score, isNewBest) => {
      resultTitle.textContent =
        status === 'completed' ? 'Grid complete' : 'Game over';
      finalScore.textContent = String(score);
      newBest.hidden = !isNewBest;
      gameOverDialog.setAttribute(
        'aria-describedby',
        isNewBest ? 'result-summary result-best' : 'result-summary',
      );
      if (!gameOverDialog.open) {
        gameOverDialog.showModal();
      }
      playAgainButton.focus();
    },
    closeSettings: () => {
      if (settings.dialog.open) {
        settings.dialog.close();
      }
    },
    closeResult: () => {
      if (gameOverDialog.open) {
        gameOverDialog.close();
      }
    },
    teardown: () => {
      settings.teardown();
      gameOverDialog.removeEventListener('cancel', preventResultCancel);
    },
  };
}
