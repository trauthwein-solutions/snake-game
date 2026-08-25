import type { GameStatus } from '../engine/model';
import type { MusicStyle } from '../storage/preferences';

export interface GameAudioSnapshot {
  readonly status: GameStatus;
  readonly runId: number;
  readonly musicEnabled: boolean;
  readonly musicStyle: MusicStyle;
  readonly soundEffectsEnabled: boolean;
}

export type AudioCue = 'food' | 'pause' | 'resume' | 'gameOver' | 'completed';

export interface GameAudio {
  sync(snapshot: GameAudioSnapshot, activation?: Event): void;
  play(cue: AudioCue): void;
  dispose(): void;
}

export type GameAudioFactory = (view: Window | undefined) => GameAudio;
