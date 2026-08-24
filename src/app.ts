import { createAnnouncer } from './ui/announcer';
import { createDialogs } from './ui/dialogs';
import { createHud } from './ui/hud';

export function mountApp(root: HTMLElement): void {
  const shell = document.createElement('main');
  shell.className = 'app-shell';
  shell.innerHTML = `
    <header class="hero">
      <p class="eyebrow">Neon arcade</p>
      <h1>SNAKISH</h1>
      <p class="subtitle">Enter the grid.</p>
    </header>

    <section class="game-panel" aria-label="Game controls and arena">
      <div data-hud></div>

      <div class="arena-frame">
        <div
          class="arena-placeholder"
          role="img"
          aria-label="SNAKISH game arena"
          aria-describedby="arena-instructions"
          data-render-target="arena"
        >
          <span aria-hidden="true">Arena ready</span>
        </div>
      </div>

      <p class="instructions" id="arena-instructions">
        Use arrow keys or swipe to guide the snake.
      </p>

      <div class="game-actions" aria-label="Game actions">
        <button class="button button--primary" type="button" data-action="play">
          Play
        </button>
        <button class="button" type="button" data-action="pause">
          Pause
        </button>
        <button class="button" type="button" data-action="restart">
          Restart
        </button>
        <button class="button" type="button" data-action="settings">
          Settings
        </button>
      </div>
    </section>
  `;

  const hudMount = shell.querySelector<HTMLElement>('[data-hud]');
  const settingsButton = shell.querySelector<HTMLButtonElement>(
    '[data-action="settings"]',
  );

  if (hudMount === null || settingsButton === null) {
    throw new Error('SNAKISH interface controls could not be created.');
  }

  hudMount.replaceWith(createHud());
  const { settingsDialog, gameOverDialog } = createDialogs(settingsButton);
  shell.append(settingsDialog, gameOverDialog, createAnnouncer());

  root.replaceChildren(shell);
  root.dataset.ready = 'true';
}
