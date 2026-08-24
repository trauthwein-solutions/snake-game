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
        <dt>Best</dt>
        <dd data-testid="best-score-value" data-score="best">0</dd>
      </div>
    </dl>
  `;

  return hud;
}
