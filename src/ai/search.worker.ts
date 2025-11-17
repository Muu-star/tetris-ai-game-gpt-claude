// src/ai/search.worker.ts
// WebWorker内でAI探索を実行

import { searchBestMoveOneStep } from './search';
import type { AiWorkerRequest, AiWorkerResponse } from './types';

// Worker内のメッセージハンドラ
self.onmessage = (e: MessageEvent<AiWorkerRequest>) => {
  const { type, state, config } = e.data;

  if (type === 'search') {
    // AI探索を実行
    const result = searchBestMoveOneStep(state, config);

    // 結果を返す
    const response: AiWorkerResponse = {
      type: 'result',
      result
    };

    self.postMessage(response);
  }
};
