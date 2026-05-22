// ESLint flat config. Next.js 16 removed `next lint`, so `npm run lint`
// runs ESLint directly. eslint-config-next is already a flat array, so we
// can spread it in.
import nextConfig from "eslint-config-next";

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
      "storage/**",
      "runtime/**",
      "models/**",
      ".venv-stt/**",
      "stt/*.py",
      "scripts/_stt-*.cjs",
    ],
  },
  ...nextConfig,
];
