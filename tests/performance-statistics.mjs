import assert from 'node:assert/strict';
import { nearestRankPercentile } from '../tools/performance/statistics.mjs';

for (const [percentage, expected] of [
  [0, 1],
  [1, 1],
  [50, 2],
  [95, 4],
  [99, 4],
  [100, 4],
]) {
  assert.equal(nearestRankPercentile([4, 1, 3, 2], percentage), expected);
}
assert.throws(() => nearestRankPercentile([], 50), /must not be empty/);
assert.throws(() => nearestRankPercentile([Number.NaN], 50), /finite numbers/);
assert.throws(() => nearestRankPercentile([1], 101), /between 0 and 100/);
