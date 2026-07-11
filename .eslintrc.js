// .eslintrc.js
module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'plugin:jsx-a11y/recommended',
  ],
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 12,
    sourceType: 'module',
  },
  plugins: ['react', 'jsx-a11y'],
  rules: {
    // Enforce that all <a> tags have a valid href
    'jsx-a11y/anchor-is-valid': ['error', { aspects: ['noHref', 'invalidHref'] }],
    // Disallow onClick without keyboard interaction on non-interactive elements
    'jsx-a11y/no-static-element-interactions': ['error'],
    // Ensure elements with onClick are keyboard accessible
    'jsx-a11y/click-events-have-key-events': ['error'],
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
};
