/** Return the deterministic nearest-rank percentile of a finite sample. */
export function nearestRankPercentile(values, percentage) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new RangeError('percentile values must not be empty');
  }
  if (!values.every((value) => Number.isFinite(value))) {
    throw new RangeError('percentile values must be finite numbers');
  }
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new RangeError('percentile must be between 0 and 100');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1);
  return sorted[rank];
}
