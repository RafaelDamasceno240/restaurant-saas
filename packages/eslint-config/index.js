module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  env: { node: true, es2021: true },
  ignorePatterns: ['dist', '.next', 'node_modules', 'generated'],
  rules: {
    // ignoreRestSiblings: true is specifically for the "omit these keys via
    // destructuring" idiom (e.g. `const { secret, ...safe } = obj; return
    // safe;`) — without it, the deliberately-unused `secret` binding would
    // warn even though not using it IS the point.
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
};
