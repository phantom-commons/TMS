import js from '@eslint/js';
import tseslint from 'typescript-eslint';


export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/build/**',
      '**/*.min.js',
      '**/*.bundle.js',
      '**/*.generated.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'three', message: 'src/sim must be pure: no render deps' },
          { name: 'phaser', message: 'src/sim must be pure: no render deps' },
          { name: '@dector/picom/three', message: 'src/sim must be pure: no render deps' },
        ],
      }],
      'no-restricted-globals': ['error',
        'window', 'document', 'localStorage', 'sessionStorage', 'indexedDB'
      ],
      'no-restricted-properties': ['error', {
        object: 'Math',
        property: 'random',
        message: 'Use a seeded PRNG in src/sim (determinism)',
      }],
      'no-restricted-syntax': ['error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Use HLC time, not Date (determinism)',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Use HLC time, not Date.now (determinism)',
        },
      ],
    },
  },
);