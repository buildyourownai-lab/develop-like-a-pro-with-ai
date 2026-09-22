import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/test/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.test.mjs",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
