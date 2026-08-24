import { createInitialState } from './engine/game-engine';
import type { Direction } from './engine/model';
import { createInputController } from './input/input-controller';
import { createTouchControls } from './input/touch-controls';
import { renderGameFrame } from './rendering/canvas-renderer';
import { createPresentationLoop } from './rendering/presentation-loop';
import { createAnnouncer } from './ui/announcer';
import { createDialogs } from './ui/dialogs';
import { createHud } from './ui/hud';

export function mountApp(root: HTMLElement): () => void {
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
        <canvas
          class="arena-canvas"
          role="img"
          aria-label="SNAKISH game arena"
          aria-describedby="arena-instructions"
          data-render-target="arena"
        >
          SNAKISH game arena. Use the nearby instructions to play.
        </canvas>
      </div>

      <p class="instructions" id="arena-instructions">
        Use arrow keys or swipe to guide the snake. WASD and the D-pad work too.
      </p>

      <div data-touch-controls></div>

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
  const canvas = shell.querySelector<HTMLCanvasElement>(
    '[data-render-target="arena"]',
  );
  const touchControlsMount = shell.querySelector<HTMLElement>(
    '[data-touch-controls]',
  );

  if (
    hudMount === null ||
    settingsButton === null ||
    canvas === null ||
    touchControlsMount === null
  ) {
    throw new Error('SNAKISH interface controls could not be created.');
  }

  hudMount.replaceWith(createHud());
  const touchControls = createTouchControls(canvas.ownerDocument);
  touchControlsMount.replaceWith(touchControls.element);
  const { settingsDialog, gameOverDialog } = createDialogs(settingsButton);
  shell.append(settingsDialog, gameOverDialog, createAnnouncer());

  root.replaceChildren(shell);
  root.dataset.ready = 'true';

  const recordDirection = (direction: Direction): void => {
    root.dataset.inputDirection = direction;
    root.dataset.inputDirectionCount = String(
      Number(root.dataset.inputDirectionCount ?? 0) + 1,
    );
  };
  const recordPauseIntent = (): void => {
    root.dataset.pauseIntent = 'toggle';
    root.dataset.pauseIntentCount = String(
      Number(root.dataset.pauseIntentCount ?? 0) + 1,
    );
  };
  const teardownInput = createInputController({
    keyboardTarget: canvas.ownerDocument,
    arena: canvas,
    touchControls,
    onDirection: recordDirection,
    onPauseToggle: recordPauseIntent,
  });

  const initialState = createInitialState();
  const view = canvas.ownerDocument.defaultView;
  const reducedMotionQuery = view?.matchMedia(
    '(prefers-reduced-motion: reduce)',
  );
  const presentationLoop = createPresentationLoop({
    cancelAnimationFrame: view?.cancelAnimationFrame.bind(view),
    prefersReducedMotion: () => reducedMotionQuery?.matches === true,
    render: (timestampMs, reducedMotion) => {
      renderGameFrame(canvas, initialState, { timestampMs, reducedMotion });
    },
    requestAnimationFrame: view?.requestAnimationFrame.bind(view),
  });

  const ResizeObserverConstructor = view?.ResizeObserver;
  let resizeObserver: ResizeObserver | undefined;
  if (ResizeObserverConstructor !== undefined) {
    resizeObserver = new ResizeObserverConstructor(presentationLoop.redraw);
    resizeObserver.observe(canvas);
  }

  reducedMotionQuery?.addEventListener(
    'change',
    presentationLoop.syncMotionPreference,
  );

  let resolutionQuery: MediaQueryList | undefined;
  let resolutionDevicePixelRatio: number | undefined;
  const armResolutionQuery = (): void => {
    resolutionQuery?.removeEventListener('change', handleResolutionChange);
    if (view === null || view === undefined) {
      resolutionQuery = undefined;
      resolutionDevicePixelRatio = undefined;
      return;
    }

    resolutionDevicePixelRatio = view.devicePixelRatio;
    resolutionQuery = view.matchMedia(
      `(resolution: ${resolutionDevicePixelRatio}dppx)`,
    );
    resolutionQuery.addEventListener('change', handleResolutionChange);
  };
  const handleResolutionChange = (): void => {
    presentationLoop.redraw();
    armResolutionQuery();
  };
  const handleResize = (): void => {
    presentationLoop.redraw();
    if (view?.devicePixelRatio !== resolutionDevicePixelRatio) {
      armResolutionQuery();
    }
  };

  view?.addEventListener('resize', handleResize);
  armResolutionQuery();

  return () => {
    teardownInput();
    presentationLoop.stop();
    resizeObserver?.disconnect();
    view?.removeEventListener('resize', handleResize);
    resolutionQuery?.removeEventListener('change', handleResolutionChange);
    reducedMotionQuery?.removeEventListener(
      'change',
      presentationLoop.syncMotionPreference,
    );
  };
}
