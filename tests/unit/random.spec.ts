import { describe, expect, it, vi } from 'vitest';

import { selectFreeCell } from '../../src/engine/random';
import type { GridPosition } from '../../src/engine/model';

const position = (x: number, y: number): GridPosition => ({ x, y });

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

describe('deterministic food placement', () => {
  it('selects the same free cell for the same seeded random source', () => {
    const occupied = [position(1, 0), position(1, 1)];

    const first = selectFreeCell(3, 2, occupied, seededRandom(42));
    const second = selectFreeCell(3, 2, occupied, seededRandom(42));

    expect(first).toEqual(position(2, 0));
    expect(second).toEqual(first);
  });

  it('enumerates free cells in row-major order', () => {
    const occupied = [position(1, 0), position(1, 1)];

    expect(selectFreeCell(3, 2, occupied, () => 0.5)).toEqual(position(0, 1));
  });

  it('selects the first free cell when the random source returns zero', () => {
    const occupied = [position(0, 0), position(1, 0)];

    expect(selectFreeCell(3, 2, occupied, () => 0)).toEqual(position(2, 0));
  });

  it('selects the last free cell when the random value approaches one', () => {
    const occupied = [position(0, 0), position(1, 0)];

    expect(selectFreeCell(3, 2, occupied, () => 0.999_999_999_999)).toEqual(
      position(2, 1),
    );
  });

  it('returns the only remaining free cell', () => {
    const occupied = [position(0, 0), position(1, 0), position(0, 1)];

    expect(selectFreeCell(2, 2, occupied, () => 0.37)).toEqual(position(1, 1));
  });

  it('returns null without consulting randomness when the board is full', () => {
    const randomSource = vi.fn(() => 0.5);
    const occupied = [
      position(0, 0),
      position(1, 0),
      position(0, 1),
      position(1, 1),
    ];

    expect(selectFreeCell(2, 2, occupied, randomSource)).toBeNull();
    expect(randomSource).not.toHaveBeenCalled();
  });

  it('ignores duplicate and out-of-grid occupied positions', () => {
    const occupied = [
      position(0, 0),
      position(0, 0),
      position(-1, 0),
      position(2, 1),
      position(0, 5),
    ];

    expect(selectFreeCell(2, 2, occupied, () => 0)).toEqual(position(1, 0));
    expect(selectFreeCell(2, 2, occupied, () => 1)).toEqual(position(1, 1));
  });

  it('does not mutate the occupied array or its positions', () => {
    const first = Object.freeze(position(1, 0));
    const second = Object.freeze(position(0, 1));
    const occupied = Object.freeze([first, second]);
    const snapshot = structuredClone(occupied);

    selectFreeCell(2, 2, occupied, () => 0.5);

    expect(occupied).toEqual(snapshot);
    expect(occupied[0]).toBe(first);
    expect(occupied[1]).toBe(second);
  });

  it.each([
    { value: Number.NaN, expected: position(0, 0) },
    { value: Number.NEGATIVE_INFINITY, expected: position(0, 0) },
    { value: -1, expected: position(0, 0) },
    { value: 1, expected: position(2, 0) },
    { value: 3, expected: position(2, 0) },
    { value: Number.POSITIVE_INFINITY, expected: position(2, 0) },
  ])(
    'safely normalizes boundary random value $value',
    ({ value, expected }) => {
      expect(selectFreeCell(3, 1, [], () => value)).toEqual(expected);
    },
  );

  it.each([
    { width: 0, height: 2 },
    { width: -1, height: 2 },
    { width: 1.5, height: 2 },
    { width: Number.NaN, height: 2 },
    { width: Number.POSITIVE_INFINITY, height: 2 },
    { width: 2, height: 0 },
    { width: 2, height: -1 },
    { width: 2, height: 1.5 },
    { width: 2, height: Number.NaN },
    { width: 2, height: Number.POSITIVE_INFINITY },
  ])(
    'rejects invalid board dimensions $width x $height',
    ({ width, height }) => {
      expect(() => selectFreeCell(width, height, [], () => 0)).toThrow(
        RangeError,
      );
    },
  );
});
