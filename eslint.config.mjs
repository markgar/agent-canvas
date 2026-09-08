import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      '**/node_modules/**',
      'vendor/**',
      '.chainkit/results/**',
      '.chainkit/runtime/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    files: ['src/contracts/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/server/**', '**/client/**'],
              message:
                'Wire contracts must not depend on runtime implementation.',
            },
            {
              regex: '^(?!\\.{1,2}/|zod(?:/|$)).+',
              message:
                'Only portable, explicitly approved dependencies belong here.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/client/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/server/**'],
              message: 'Browser code must not import server implementation.',
            },
            {
              regex: '^(?!\\.{1,2}/|zod(?:/|$)).+',
              message:
                'Only portable, explicitly approved dependencies belong here.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/server/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/client/**'],
              message:
                'The server and shared contracts must not import browser implementation.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
