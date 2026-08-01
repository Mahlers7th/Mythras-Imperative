import js from '@eslint/js';
import globals from 'globals';

/**
 * Flat ESLint config. This codebase is dense, comment-heavy, and was not
 * written to any particular style guide beyond internal consistency (2-space
 * indent, single quotes, semicolons) — see .prettierrc.json for the
 * formatting side. Rules here are deliberately conservative: catch real bugs
 * (unused vars, undefined globals, unreachable code), not enforce a style
 * that would flag the existing codebase wholesale. `npm run lint` is a dev
 * tool, not (yet) a CI gate — see .github/workflows/test.yml.
 */
export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Foundry VTT globals — not an npm package, injected by the client.
        game: 'readonly',
        foundry: 'readonly',
        CONFIG: 'readonly',
        CONST: 'readonly',
        Hooks: 'readonly',
        Actor: 'readonly',
        Actors: 'readonly',
        Item: 'readonly',
        Items: 'readonly',
        ActiveEffect: 'readonly',
        ChatMessage: 'readonly',
        Dialog: 'readonly',
        DialogV2: 'readonly',
        DocumentSheetConfig: 'readonly',
        Application: 'readonly',
        ApplicationV2: 'readonly',
        Roll: 'readonly',
        RollTable: 'readonly',
        Handlebars: 'readonly',
        TextEditor: 'readonly',
        ui: 'readonly',
        canvas: 'readonly',
        Token: 'readonly',
        TokenDocument: 'readonly',
        Combat: 'readonly',
        CombatEncounters: 'readonly',
        Scene: 'readonly',
        Region: 'readonly',
        RegionBehavior: 'readonly',
        CompendiumCollection: 'readonly',
        JournalEntry: 'readonly',
        FilePicker: 'readonly',
        fromUuid: 'readonly',
        fromUuidSync: 'readonly',
        renderTemplate: 'readonly',
        PIXI: 'readonly',
        Color: 'readonly',
        $: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  {
    // macros/ — raw Foundry Macro documents, pasted into the Macro UI and run
    // with Foundry's own implicit top-level-await wrapper; not real ES
    // modules and not shipped in system.json's esmodules list.
    // spike-a2-typetest/ — a throwaway Phase 0 prototype (its own stub
    // module.json), never wired into the real system.
    ignores: ['packs/**', 'node_modules/**', '**/*.min.js', 'macros/**', 'spike-a2-typetest/**'],
  },
];
