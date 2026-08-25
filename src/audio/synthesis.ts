export type SynthesizedGameAudio = Readonly<{
  music: Float32Array;
  food: Float32Array;
  pause: Float32Array;
  resume: Float32Array;
  gameOver: Float32Array;
  completed: Float32Array;
}>;

const TAU = Math.PI * 2;

const envelope = (position: number): number => {
  const edge = 0.08;
  return Math.min(1, position / edge, (1 - position) / edge);
};

const synthesizeNotes = (
  sampleRate: number,
  frequencies: readonly number[],
  noteDurationSeconds: number,
  peak: number,
): Float32Array => {
  const sampleCount = Math.max(
    2,
    Math.round(sampleRate * noteDurationSeconds * frequencies.length),
  );
  const samples = new Float32Array(sampleCount);
  let phase = 0;

  for (let index = 1; index < sampleCount - 1; index += 1) {
    const position = index / (sampleCount - 1);
    const notePosition = position * frequencies.length;
    const noteIndex = Math.min(
      frequencies.length - 1,
      Math.floor(notePosition),
    );
    const frequency = frequencies[noteIndex] ?? frequencies[0] ?? 220;
    phase += (TAU * frequency) / sampleRate;
    const voice = Math.sin(phase) * 0.8 + Math.sin(phase * 2) * 0.2;
    samples[index] = peak * envelope(position) * voice;
  }

  return samples;
};

export function synthesizeGameAudio(sampleRate: number): SynthesizedGameAudio {
  if (!Number.isFinite(sampleRate) || sampleRate < 1) {
    throw new RangeError('Audio sample rate must be a positive finite number.');
  }

  return Object.freeze({
    music: synthesizeNotes(
      sampleRate,
      [164.81, 196, 246.94, 220, 164.81, 196, 293.66, 246.94],
      0.24,
      0.18,
    ),
    food: synthesizeNotes(sampleRate, [659.25, 880], 0.055, 0.24),
    pause: synthesizeNotes(sampleRate, [392, 293.66], 0.075, 0.2),
    resume: synthesizeNotes(sampleRate, [293.66, 440], 0.075, 0.2),
    gameOver: synthesizeNotes(
      sampleRate,
      [329.63, 246.94, 196, 146.83],
      0.11,
      0.22,
    ),
    completed: synthesizeNotes(
      sampleRate,
      [261.63, 329.63, 392, 523.25],
      0.09,
      0.22,
    ),
  });
}
