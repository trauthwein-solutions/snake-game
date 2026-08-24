export interface RendererPalette {
  readonly background: string;
  readonly grid: string;
  readonly gridStrong: string;
  readonly snakeBody: string;
  readonly snakeHead: string;
  readonly snakeDetail: string;
  readonly food: string;
  readonly foodDetail: string;
  readonly glow: string;
  readonly foodShape: 'diamond';
}

export const NORMAL_PALETTE: RendererPalette = {
  background: '#051017',
  grid: '#12303a',
  gridStrong: '#1b4350',
  snakeBody: '#64e6b2',
  snakeHead: '#83fff1',
  snakeDetail: '#062229',
  food: '#ff6f91',
  foodDetail: '#fff1a8',
  glow: '#52f2da',
  foodShape: 'diamond',
};

export const HIGH_CONTRAST_PALETTE: RendererPalette = {
  background: '#000000',
  grid: '#666666',
  gridStrong: '#a3a3a3',
  snakeBody: '#ffffff',
  snakeHead: '#00ffff',
  snakeDetail: '#000000',
  food: '#ffcc00',
  foodDetail: '#000000',
  glow: '#ffffff',
  foodShape: 'diamond',
};

export const paletteForMode = (
  mode: 'normal' | 'high-contrast',
): RendererPalette =>
  mode === 'high-contrast' ? HIGH_CONTRAST_PALETTE : NORMAL_PALETTE;
