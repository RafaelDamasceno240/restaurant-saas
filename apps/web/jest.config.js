// Uses Next's own Jest preset (next/jest) so SWC transforms and the app's
// tsconfig/path-aliases are handled the same way Next.js itself handles
// them — avoids hand-rolling a ts-jest config that could drift from what
// `next build` actually does.
const nextJest = require('next/jest');

const createJestConfig = nextJest({ dir: './' });

/** @type {import('jest').Config} */
const customJestConfig = {
  testEnvironment: 'jsdom',
  testMatch: ['**/*.test.ts'],
};

module.exports = createJestConfig(customJestConfig);
