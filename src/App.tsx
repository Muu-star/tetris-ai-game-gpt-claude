// src/App.tsx
import React from "react";
import "./App.css";
import { TetrisRenderer } from "./ui/renderer";

// なぜ: アプリ全体のエントリポイントとして、今回の最小テトリスUIを表示する。
function App() {
  return (
    <div
      className="App"
      style={{
        padding: "16px",
        fontFamily: "sans-serif",
        color: "#eee",
        backgroundColor: "#202020",
        minHeight: "100vh"
      }}
    >
      <h1 style={{ marginBottom: "8px" }}>テトリスAI統合ゲーム（UI最小版）</h1>
      <p style={{ marginTop: 0, marginBottom: "16px", fontSize: 14 }}>
        ※ まだスコア・AI・ロック遅延・7-bag は未実装です。重力とキー入力で動く最小版です。
      </p>
      <TetrisRenderer />
    </div>
  );
}

export default App;
