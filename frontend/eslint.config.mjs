import nextCoreWebVitals from "eslint-config-next/core-web-vitals"
import nextTypescript from "eslint-config-next/typescript"

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Regras com muitas ocorrências no código atual começam como aviso para não
    // travar o CI; serão promovidas a erro conforme o código for ajustado.
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    ignores: [".next/**", ".next-*/**", "node_modules/**", "next-env.d.ts", "tests/**"],
  },
]

export default eslintConfig
