import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// なぜ: Reactアプリ用のVite設定と、Vitestの設定を1か所にまとめる。
//       プラグインは package.json に合わせて @vitejs/plugin-react を使用する。
export default defineConfig({
  plugins: [react() as any],
  test: {
    environment: "node", // DOM不要なロジックテストなので node で十分
    include: ["src/**/*.test.{ts,tsx}"]
  }
});
