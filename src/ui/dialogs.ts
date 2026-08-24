interface GameDialogs {
  settingsDialog: HTMLDialogElement;
  gameOverDialog: HTMLDialogElement;
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
): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog-card';
  dialog.id = 'settings-dialog';
  dialog.setAttribute('aria-labelledby', 'settings-title');
  dialog.innerHTML = `
    <div class="dialog-heading">
      <div>
        <p class="dialog-kicker">Tune your run</p>
        <h2 id="settings-title">Settings</h2>
      </div>
      <button class="icon-button" type="button" aria-label="Close settings">×</button>
    </div>
    <div class="settings-list">
      ${createSetting('Music', true)}
      ${createSetting('Sound effects', true)}
      ${createSetting('Reduced motion')}
      ${createSetting('High contrast')}
    </div>
  `;

  const closeButton = dialog.querySelector<HTMLButtonElement>('.icon-button');
  const firstControl = dialog.querySelector<HTMLInputElement>('input');

  if (closeButton === null || firstControl === null) {
    throw new Error('Settings dialog controls could not be created.');
  }

  settingsButton.addEventListener('click', () => {
    dialog.showModal();
    firstControl.focus();
  });
  closeButton.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => settingsButton.focus());

  return dialog;
}

function createGameOverDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog-card dialog-card--game-over';
  dialog.id = 'game-over-dialog';
  dialog.setAttribute('aria-labelledby', 'game-over-title');
  dialog.innerHTML = `
    <p class="dialog-kicker">Run complete</p>
    <h2 id="game-over-title">Game over</h2>
    <p class="final-score">
      <span>Final score</span>
      <strong data-testid="final-score-value" data-score="final">0</strong>
    </p>
    <p class="new-best" data-testid="new-best" data-new-best hidden>New best!</p>
    <div class="dialog-actions">
      <button class="button button--primary" type="button" data-action="play-again">
        Play again
      </button>
      <button class="button" type="button" data-action="return-to-title">
        Return to title
      </button>
    </div>
  `;

  return dialog;
}

export function createDialogs(settingsButton: HTMLButtonElement): GameDialogs {
  return {
    settingsDialog: createSettingsDialog(settingsButton),
    gameOverDialog: createGameOverDialog(),
  };
}
