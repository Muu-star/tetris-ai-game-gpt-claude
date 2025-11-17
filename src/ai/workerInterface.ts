// src/ai/workerInterface.ts
// AI Worker通信インターフェース

import type { AiGameState, AiSearchConfig, AiResponse, AiWorkerRequest, AiWorkerResponse } from './types';
import SearchWorker from './search.worker?worker';

class AiWorkerInterface {
  private worker: Worker | null = null;
  private pendingRequest: ((result: AiResponse) => void) | null = null;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    try {
      this.worker = new SearchWorker();
      this.worker.onmessage = this.handleMessage.bind(this);
      this.worker.onerror = this.handleError.bind(this);
    } catch (error) {
      console.error('Failed to initialize AI Worker:', error);
      this.worker = null;
    }
  }

  private handleMessage(e: MessageEvent<AiWorkerResponse>) {
    const { type, result } = e.data;

    if (type === 'result' && this.pendingRequest) {
      this.pendingRequest(result);
      this.pendingRequest = null;
    }
  }

  private handleError(error: ErrorEvent) {
    console.error('AI Worker error:', error);
    if (this.pendingRequest) {
      // エラー時は空の結果を返す
      this.pendingRequest({
        best: null,
        exploredStates: 0,
        elapsedMs: 0
      });
      this.pendingRequest = null;
    }
  }

  /**
   * AI探索を実行（Promise-based）
   */
  async search(state: AiGameState, config: AiSearchConfig): Promise<AiResponse> {
    if (!this.worker) {
      // Workerが使えない場合は、メインスレッドで実行
      // （フォールバック用に元のコードをインポート）
      const { searchBestMoveOneStep } = await import('./search');
      return searchBestMoveOneStep(state, config);
    }

    return new Promise<AiResponse>((resolve) => {
      this.pendingRequest = resolve;

      const request: AiWorkerRequest = {
        type: 'search',
        state,
        config
      };

      this.worker!.postMessage(request);
    });
  }

  /**
   * Workerをクリーンアップ
   */
  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequest = null;
  }
}

// シングルトンインスタンス
let aiWorkerInstance: AiWorkerInterface | null = null;

/**
 * AI Worker インスタンスを取得
 */
export function getAiWorker(): AiWorkerInterface {
  if (!aiWorkerInstance) {
    aiWorkerInstance = new AiWorkerInterface();
  }
  return aiWorkerInstance;
}

/**
 * AI Worker インスタンスを破棄
 */
export function disposeAiWorker() {
  if (aiWorkerInstance) {
    aiWorkerInstance.dispose();
    aiWorkerInstance = null;
  }
}
