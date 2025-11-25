// src/App.tsx
import { Component, ErrorInfo, ReactNode } from "react";
import "./App.css";
import { TetrisRenderer } from "./ui/renderer";

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20, color: "red", backgroundColor: "#fff" }}>
          <h1>Something went wrong.</h1>
          <pre>{this.state.error?.toString()}</pre>
        </div>
      );
    }

    return this.props.children;
  }
}

// なぜ: アプリ全体のエントリポイントとして、今回の最小テトリスUIを表示する。
function App() {
  return (
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}

export default App;
