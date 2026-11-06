export default [
  {
    files: ["js/**/*.js", "tools/**/*.js", "test/sim.test.js", "test/home-hint.test.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        AudioContext: "readonly",
        webkitAudioContext: "readonly",
        localStorage: "readonly",
        performance: "readonly",
        FontFace: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        process: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        location: "readonly",
        structuredClone: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { args: "none", varsIgnorePattern: "^_" }],
      "no-undef": "error",
      eqeqeq: ["error", "always"],
    },
  },
];
