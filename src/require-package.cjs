'use strict';

// Bare package resolution must be identical in the ESM and CommonJS builds.
exports.requirePackage = function requirePackage(name) {
  return require(name);
};
