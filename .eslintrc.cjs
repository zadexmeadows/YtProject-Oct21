module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'next/core-web-vitals'],
  ignorePatterns: [
    'node_modules',
    '.next',
    'dist',
    'coverage',
    'storage',
    'playwright-report',
    'next-env.d.ts'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@next/next/no-img-element': 'off'
  }
};
