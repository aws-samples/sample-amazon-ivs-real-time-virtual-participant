import { FlatCompat } from '@eslint/eslintrc';
import eslint from '@eslint/js';
import configPrettier from 'eslint-config-prettier';
import pluginImport from 'eslint-plugin-import';
import pluginJson from 'eslint-plugin-json';
import pluginMarkdown from 'eslint-plugin-markdown';
import pluginPromise from 'eslint-plugin-promise';
import pluginSimpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import path from 'path';
import tseslint from 'typescript-eslint';
import url from 'url';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = tseslint.config(
  { ignores: ['**/node_modules', '**/build', '**/dist', 'cdk.out', '**/*.md'] },

  {
    files: ['**/*.{js,ts}'],
    extends: [
      eslint.configs.recommended,
      ...compat.extends('eslint-config-standard'),
      ...tseslint.configs.stylisticTypeChecked,
      ...tseslint.configs.recommendedTypeChecked,
      pluginPromise.configs['flat/recommended']
    ],

    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
      parserOptions: { tsconfigRootDir: __dirname, project: './tsconfig.json' }
    },

    plugins: {
      import: pluginImport,
      'simple-import-sort': pluginSimpleImportSort,
      '@typescript-eslint': tseslint.plugin
    },

    rules: {
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      'no-use-before-define': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],

      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'variableLike',
          leadingUnderscore: 'allowSingleOrDouble',
          trailingUnderscore: 'allowSingleOrDouble',
          format: ['camelCase', 'PascalCase', 'snake_case', 'UPPER_CASE']
        }
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: false }
      ],
      '@typescript-eslint/no-floating-promises': ['off'],

      'no-new': 'off',
      'accessor-pairs': 'off',
      'prefer-const': 'error',
      'require-await': 'error',
      'consistent-return': 'off',
      'no-underscore-dangle': 'off',
      'no-console': ['warn', { allow: ['error', 'warn', 'info'] }],
      'no-restricted-exports': ['error', { restrictedNamedExports: ['then'] }],
      'arrow-body-style': ['error', 'as-needed'],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: 'block-like', next: '*' }
      ],

      // Imports
      'import/default': 'off',
      'import/extensions': 'off',
      'import/named': 'off',
      'import/namespace': 'off',
      'import/no-named-as-default': 'off',
      'import/no-named-as-default-member': 'off',
      'import/no-unresolved': 'off',
      'import/first': 'error',
      'import/newline-after-import': 'error',
      'import/no-cycle': 'error',
      'import/no-duplicates': 'error',
      'import/no-unused-modules': 'error',
      'import/order': 'off', // handled by simple-import-sort
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // Syntax
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ForInStatement',
          message:
            'for..in loops iterate over the entire prototype chain, which is virtually never what you want. Use Object.{keys,values,entries}, and iterate over the resulting array.'
        },
        {
          selector: 'LabeledStatement',
          message:
            'Labels are a form of GOTO; using them makes code confusing and hard to maintain and understand.'
        },
        {
          selector: 'WithStatement',
          message:
            '`with` is disallowed in strict mode because it makes code impossible to predict and optimize.'
        }
      ]
    }
  },

  // Configure virtualparticipant-specific language options
  {
    files: ['virtualparticipant/**/*.{js,ts}'],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: path.resolve(__dirname, 'virtualparticipant'),
        project: ['./tsconfig.json', './tsconfig.node.json']
      }
    }
  },

  // Disable type-aware linting on .js files
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked
  },

  // Enable the JSON processor on .json files
  pluginJson.configs.recommended,

  // Enable the Markdown processor on .md files
  ...pluginMarkdown.configs.recommended,

  // Add prettier as the last config
  configPrettier
);

export default config;
