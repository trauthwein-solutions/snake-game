export function createAnnouncer(): HTMLElement {
  const announcer = document.createElement('p');
  announcer.className = 'visually-hidden';
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');
  announcer.setAttribute('aria-atomic', 'true');
  announcer.dataset.announcer = 'game-status';

  return announcer;
}

export function announce(announcer: HTMLElement, message: string): void {
  announcer.textContent = message;
}
