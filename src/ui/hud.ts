export function createHud(): HTMLElement {
  const hud = document.createElement('section');
  hud.className = 'hud';
  hud.setAttribute('aria-label', 'Scoreboard');
  hud.innerHTML = `
    <dl class="scoreboard">
      <div class="scoreboard__item">
        <dt>Score</dt>
        <dd data-testid="score-value" data-score="current">0</dd>
      </div>
      <div class="scoreboard__item">
        <dt>Best score</dt>
        <dd data-testid="best-score-value" data-score="best">0</dd>
      </div>
    </dl>
  `;

  return hud;
}

export function updateHudScore(hud: HTMLElement, score: number): void {
  const scoreValue = hud.querySelector<HTMLElement>('[data-score="current"]');

  if (scoreValue === null) {
    throw new Error('SNAKISH score display could not be found.');
  }

  scoreValue.textContent = String(score);
}

export function updateHudBestScore(hud: HTMLElement, bestScore: number): void {
  const bestScoreValue = hud.querySelector<HTMLElement>('[data-score="best"]');

  if (bestScoreValue === null) {
    throw new Error('SNAKISH best score display could not be found.');
  }

  bestScoreValue.textContent = String(bestScore);
}
