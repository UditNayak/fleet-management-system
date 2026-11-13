const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  { ignores: ['node_modules/', 'reports/', 'coverage/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  { files: ['test/**/*.js'], languageOptions: { globals: globals.mocha } },
  // Dashboard: ES modules in the browser; Leaflet is loaded as a global script (L)
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser, L: 'readonly' } },
  },
  prettier,
];
