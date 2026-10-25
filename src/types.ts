export type ModelInfo = {
  id: string;
  name: string;
  tag: string;
  description: string;
  steps: number;
  guidance: number | null;
  maxSide: number;
  curated?: boolean;
  recommendedSize?: string;
  /** 编辑 / 图生图能力：maxImages 最多参考图数，required 是否必须垫图 */
  edit?: { maxImages: number; required: boolean };
  /** 每次调用的魔方档位（官方：轻量 0.5 / 标准 1 / 重型 2） */
  cost?: number;
};

export type Quota = {
  totalLimit: number | null;
  totalRemaining: number | null;
  modelLimit: number | null;
  modelRemaining: number | null;
  updatedAt: string;
};

export type AppState = {
  ok: boolean;
  version: string;
  hasToken: boolean;
  tokenMasked: string;
  accessRequired: boolean;
  defaultModel: string;
  defaultRatio: string;
  defaultQuality: "standard" | "high";
  quota: Quota | null;
  /** 本地计数的每日用量（魔搭无余额接口）：magicubes 按模型档位加权估算 */
  usage: { images: number; chats: number; total: number; magicubes: number; dailyLimit: number };
  /** APK 支持网页登录查询魔方余额 */
  webLogin?: boolean;
  hasCookie?: boolean;
  stats: { total: number; today: number; favorites: number };
  server: { port: number; urls: string[] };
};

export type TaskStage = "submitting" | "generating" | "downloading" | "done";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type Task = {
  id: string;
  status: TaskStatus;
  stage: TaskStage;
  upstreamStatus: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  model: string;
  modelName: string;
  prompt: string;
  negativePrompt: string;
  size: string;
  width: number;
  height: number;
  seed: number | null;
  steps: number | null;
  guidance: number | null;
  imageUrl?: string;
  historyId?: string;
  error?: string;
  errorStatus?: number;
  requestId?: string;
  elapsedMs: number;
};

export type HistoryItem = {
  id: string;
  createdAt: string;
  model: string;
  modelName: string;
  prompt: string;
  negativePrompt: string;
  size: string;
  width: number;
  height: number;
  seed: number | null;
  steps: number | null;
  guidance: number | null;
  file: string;
  elapsedMs: number;
  favorite: boolean;
};

export type GeneratePayload = {
  model: string;
  prompt: string;
  negativePrompt?: string;
  size: string;
  seed?: number | null;
  steps?: number | null;
  guidance?: number | null;
  /** 编辑 / 图生图的参考图（data URL） */
  images?: string[];
};
