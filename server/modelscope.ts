const BASE = "https://api-inference.modelscope.cn/v1";

export type Quota = {
  totalLimit: number | null;
  totalRemaining: number | null;
  modelLimit: number | null;
  modelRemaining: number | null;
  updatedAt: string;
};

export let lastQuota: Quota | null = null;

export class MsError extends Error {
  status: number;
  requestId: string | null;
  constructor(message: string, status = 0, requestId: string | null = null) {
    super(message);
    this.name = "MsError";
    this.status = status;
    this.requestId = requestId;
  }
}

function num(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function captureQuota(headers: Headers): void {
  const totalLimit = num(headers.get("modelscope-ratelimit-requests-limit"));
  const totalRemaining = num(headers.get("modelscope-ratelimit-requests-remaining"));
  const modelLimit = num(headers.get("modelscope-ratelimit-model-requests-limit"));
  const modelRemaining = num(headers.get("modelscope-ratelimit-model-requests-remaining"));
  if ([totalLimit, totalRemaining, modelLimit, modelRemaining].some((v) => v !== null)) {
    lastQuota = {
      totalLimit,
      totalRemaining,
      modelLimit,
      modelRemaining,
      updatedAt: new Date().toISOString(),
    };
  }
}

async function readError(res: Response): Promise<MsError> {
  let message = `请求失败（HTTP ${res.status}）`;
  let requestId: string | null = null;
  try {
    const data = (await res.json()) as Record<string, unknown>;
    const errors = data.errors as { message?: string } | undefined;
    const err = data.error as { message?: string } | string | undefined;
    if (errors?.message) message = errors.message;
    else if (typeof err === "string") message = err;
    else if (err && typeof err === "object" && err.message) message = err.message;
    else if (typeof data.message === "string") message = data.message;
    if (typeof data.request_id === "string") requestId = data.request_id;
  } catch {
    /* ignore */
  }
  return new MsError(message, res.status, requestId);
}

const FRIENDLY: Record<number, string> = {
  400: "请求参数不被接受，试着简化提示词或换一组参数",
  401: "Token 无效或已过期，请到设置里重新填写",
  403: "账号未完成绑定或实名认证，请到魔搭完成后再试",
  404: "该模型当前不可用，换一个模型试试",
  429: "额度或并发已到上限，稍后再试或换模型",
  500: "魔搭服务端出错，稍后重试",
  503: "魔搭服务繁忙，稍后重试",
};

export function friendlyError(err: unknown): { message: string; status: number; requestId?: string } {
  if (err instanceof MsError) {
    if ((err as MsError & { raw?: boolean }).raw) {
      return {
        message: err.message,
        status: err.status,
        ...(err.requestId ? { requestId: err.requestId } : {}),
      };
    }
    const hint = FRIENDLY[err.status];
    return {
      message: hint ? `${hint}（${err.message}）` : err.message,
      status: err.status,
      ...(err.requestId ? { requestId: err.requestId } : {}),
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|aborted/i.test(msg)) {
    return { message: "连接魔搭失败，请检查本机网络后重试", status: 0 };
  }
  return { message: msg, status: 0 };
}

export type SubmitParams = {
  model: string;
  prompt: string;
  negativePrompt?: string;
  size?: string;
  seed?: number;
  steps?: number;
  guidance?: number;
  /** 编辑 / 图生图的参考图（data URL），对应上游 image_url */
  images?: string[];
};

export async function submitImage(
  token: string,
  params: SubmitParams,
  signal?: AbortSignal,
): Promise<{ taskId: string; requestId: string | null }> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
  };
  if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
  if (params.size) body.size = params.size;
  if (typeof params.seed === "number") body.seed = params.seed;
  if (typeof params.steps === "number") body.steps = params.steps;
  if (typeof params.guidance === "number") body.guidance = params.guidance;
  if (params.images && params.images.length > 0) body.image_url = params.images;

  const res = await fetch(`${BASE}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-ModelScope-Async-Mode": "true",
    },
    body: JSON.stringify(body),
    signal,
  });
  captureQuota(res.headers);
  if (!res.ok) throw await readError(res);

  const data = (await res.json()) as { task_id?: string; request_id?: string };
  if (!data.task_id) throw new MsError("魔搭没有返回 task_id", res.status, data.request_id ?? null);
  return { taskId: data.task_id, requestId: data.request_id ?? null };
}

export type PollResult = {
  status: "pending" | "succeeded" | "failed";
  rawStatus: string;
  imageUrl?: string;
  error?: string;
};

export async function pollImageTask(
  token: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<PollResult> {
  const res = await fetch(`${BASE}/tasks/${taskId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-ModelScope-Task-Type": "image_generation",
    },
    signal,
  });
  captureQuota(res.headers);
  if (!res.ok) throw await readError(res);

  const data = (await res.json()) as Record<string, unknown>;
  const rawStatus = String(data.task_status ?? "").toUpperCase();

  if (rawStatus === "SUCCEED" || rawStatus === "SUCCEEDED") {
    let url: string | undefined;
    const out = data.output_images;
    if (Array.isArray(out) && out.length > 0) url = String(out[0]);
    else if (typeof out === "string") url = out;
    if (url) return { status: "succeeded", rawStatus, imageUrl: url };

    const images = data.images;
    if (Array.isArray(images) && images.length > 0) {
      const first = images[0];
      if (typeof first === "string") url = first;
      else if (first && typeof first === "object" && "url" in first) url = String((first as { url: unknown }).url);
    }
    if (url) return { status: "succeeded", rawStatus, imageUrl: url };
    return { status: "failed", rawStatus, error: "任务成功但没有返回图片地址" };
  }

  if (rawStatus === "FAILED" || rawStatus === "FAIL" || rawStatus === "ERROR") {
    let msg = "生成失败";
    const errors = data.errors;
    if (errors && typeof errors === "object" && "message" in errors) {
      msg = String((errors as { message: unknown }).message);
    } else if (typeof data.message === "string") {
      msg = data.message;
    }
    return { status: "failed", rawStatus, error: msg };
  }

  return { status: "pending", rawStatus: rawStatus || "PENDING" };
}

export async function downloadImage(url: string, signal?: AbortSignal): Promise<{ buffer: Buffer; ext: string }> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new MsError(`下载图片失败（HTTP ${res.status}）`, res.status);
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  const ext = type.includes("jpeg") || type.includes("jpg") ? "jpg" : type.includes("webp") ? "webp" : "png";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, ext };
}

export async function verifyToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    captureQuota(res.headers);
    if (res.status === 401 || res.status === 403) return false;
    return res.ok;
  } catch {
    throw new MsError("连接魔搭失败，请检查网络", 0);
  }
}

// ---------------- 提示词助手（对话模型） ----------------

export const ASSISTANT_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
/** 带图与纯文本共用同一个多模态模型（实测带图 9s 出结果，第三方 VL 系列 401 不可用） */
export const ASSISTANT_VL_MODEL = ASSISTANT_MODEL;

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export async function chatCompletion(
  token: string,
  messages: ChatMsg[],
  chatModel?: string,
  images?: string[],
): Promise<{ reply: string; chatModel: string }> {
  const useVision = Array.isArray(images) && images.length > 0;
  const model = chatModel?.trim() || (useVision ? ASSISTANT_VL_MODEL : ASSISTANT_MODEL);

  // 把参考图以 OpenAI 视觉格式挂到最后一条用户消息上
  const payload: Array<{ role: string; content: unknown }> = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  if (useVision) {
    for (let i = payload.length - 1; i >= 0; i--) {
      if (payload[i].role === "user") {
        const content: unknown[] = [{ type: "text", text: payload[i].content as string }];
        for (const img of images!.slice(0, 4)) {
          content.push({ type: "image_url", image_url: { url: img } });
        }
        payload[i] = { role: "user", content };
        break;
      }
    }
  }

  const call = (withThinking: boolean): Promise<Response> =>
    fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: payload,
        stream: false,
        temperature: 0.8,
        max_tokens: 4000,
        // 混合思考模型开启思考提升质量；不认识的模型可能 400，退回普通请求
        ...(withThinking ? { enable_thinking: true } : {}),
      }),
      signal: AbortSignal.timeout(180_000),
    });

  let res = await call(true);
  if (res.status === 400) res = await call(false);
  captureQuota(res.headers);
  if (!res.ok) throw await readError(res);

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  };
  // reasoning_content（思考过程）直接忽略，只取最终回答
  let reply = data.choices?.[0]?.message?.content ?? "";
  reply = reply.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!reply) throw new MsError("助手没有返回内容，稍后再试", 502);
  return { reply, chatModel: model };
}

/** 轻量探测一次额度（GET /models 不消耗生图额度，但带 ratelimit 响应头） */
export async function probeQuota(token: string): Promise<Quota | null> {
  try {
    const res = await fetch(`${BASE}/models`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    captureQuota(res.headers);
  } catch {
    /* 网络失败时保留旧值 */
  }
  return lastQuota;
}
