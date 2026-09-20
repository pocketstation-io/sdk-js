export function requireBoolean(name: string, value: boolean): void {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${name} must be a boolean`);
  }
}

export function requireInteger(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  if (value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
}

export function requireFiniteNumber(
  name: string,
  value: number,
  minimumExclusive: number,
  maximumInclusive: number,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  if (value <= minimumExclusive || value > maximumInclusive) {
    throw new RangeError(
      `${name} must be greater than ${minimumExclusive} and at most ${maximumInclusive}`,
    );
  }
}

export function requireOptionalPositiveInteger(
  name: string,
  value: number | undefined,
): void {
  if (value === undefined) return;
  requireInteger(name, value, 1, Number.MAX_SAFE_INTEGER);
}

export function requireNonNegativeInteger(name: string, value: number): void {
  requireInteger(name, value, 0, Number.MAX_SAFE_INTEGER);
}

export function requireNonNegativeBigInt(
  name: string,
  value: bigint,
): void {
  if (typeof value !== 'bigint' || value < 0n) {
    throw new TypeError(`${name} must be a non-negative bigint`);
  }
}

export function requirePositiveBigInt(
  name: string,
  value: bigint,
): void {
  if (typeof value !== 'bigint' || value < 1n) {
    throw new TypeError(`${name} must be a positive bigint`);
  }
}

export function requireOptionalNonNegativeBigInt(
  name: string,
  value: bigint | undefined,
): void {
  if (value !== undefined) requireNonNegativeBigInt(name, value);
}

export function requireOptionalPositiveBigInt(
  name: string,
  value: bigint | undefined,
): void {
  if (value !== undefined) requirePositiveBigInt(name, value);
}

export function requireNonEmpty(name: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RangeError(`${name} must not be empty`);
  }
}

export function requireOptionalNonEmpty(
  name: string,
  value: string | undefined,
): void {
  if (value !== undefined) requireNonEmpty(name, value);
}

export function requireInclusiveNumber(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  if (value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`);
  }
}

export function characterCount(value: string): number {
  return [...value].length;
}

export function immutableArray<T>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values]);
}

export function immutableStrings(values: readonly string[]): readonly string[] {
  return immutableArray(values);
}

export function validateSampleRates(values: readonly number[]): void {
  const seen = new Set<number>();
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError('supported sample rates must be positive integers');
    }
    if (seen.has(value)) {
      throw new RangeError('supported sample rates must not contain duplicates');
    }
    seen.add(value);
  }
}
