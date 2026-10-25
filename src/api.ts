import type { AppState, GeneratePayload, HistoryItem, ModelInfo, Task } from "./types";

const CODE_KEY = "mstudio.accessCode";
let accessCode = localStorage.getItem(CODE_KEY) ?? "";

export function getAccessCode(): string {
  return accessCode;
}

export function setAccessCode(code: string): void {
  accessCode = code.trim();
  if (accessCode) localStorage.setItem(CODE_KEY, accessCode);
  else localStorage.removeItem(CODE_KEY);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class AccessRequiredError extends Error {
  constructor() {
    super("需要访问码");
    this.name = "AccessRequiredError";
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(accessCode ? { "x-access-code": accessCode } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(path, { ...init, headers });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && data.code === "access_required") throw new AccessRequiredError();
    throw new ApiError(String(data.error ?? `请求失败（${res.status}）`), res.status, data.code as string | undefined);
  }
  return data as T;
}

export function getState(): Promise<AppState> {
  return req<AppState>("/api/state");
}

export async function getModels(): Promise<ModelInfo[]> {
  const data = await req<{ models: ModelInfo[] }>("/api/models");
  return data.models;
}

export async function getHistory(limit = 300): Promise<HistoryItem[]> {
  const data = await req<{ items: HistoryItem[] }>(`/api/history?limit=${limit}`);
  return data.items;
}

export function saveToken(token: string): Promise<{ hasToken: boolean; tokenMasked: string }> {
  return req("/api/config/token", { method: "POST", body: JSON.stringify({ token }) });
}

export function clearToken(): Promise<unknown> {
  return req("/api/config/token", { method: "DELETE" });
}

export function testToken(token?: string): Promise<{ ok: boolean; quota?: unknown }> {
  return req("/api/config/test", { method: "POST", body: JSON.stringify({ token: token ?? "" }) });
}

export function savePrefs(patch: Record<string, unknown>): Promise<unknown> {
  return req("/api/config/prefs", { method: "POST", body: JSON.stringify(patch) });
}

export async function generate(payload: GeneratePayload): Promise<Task> {
  const data = await req<{ task: Task }>("/api/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.task;
}

export async function getTask(id: string): Promise<Task> {
  const data = await req<{ task: Task }>(`/api/tasks/${id}`);
  return data.task;
}

export async function cancelTask(id: string): Promise<Task> {
  const data = await req<{ task: Task }>(`/api/tasks/${id}/cancel`, { method: "POST" });
  return data.task;
}

export function deleteHistory(id: string): Promise<unknown> {
  return req(`/api/history/${id}`, { method: "DELETE" });
}

export async function toggleFavorite(id: string): Promise<HistoryItem> {
  const data = await req<{ item: HistoryItem }>(`/api/history/${id}/favorite`, { method: "POST" });
  return data.item;
}

export async function assistantChat(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  imageModel: string,
  images?: string[],
): Promise<{ reply: string; chatModel: string }> {
  return req("/api/assistant/chat", {
    method: "POST",
    body: JSON.stringify({
      messages,
      imageModel,
      ...(images && images.length ? { images } : {}),
    }),
  });
}

export async function refreshQuota(): Promise<{ quota: unknown }> {
  return req("/api/quota/refresh");
}

export type MagicubeResult = {
  ok: boolean;
  auth?: string;
  data?: unknown;
  error?: string;
};

export function getMagicube(): Promise<MagicubeResult> {
  return req("/api/magicube");
}

export function saveCookie(cookie: string): Promise<unknown> {
  return req("/api/config/cookie", { method: "POST", body: JSON.stringify({ cookie }) });
}

export function clearCookie(): Promise<unknown> {
  return req("/api/config/cookie", { method: "DELETE" });
}

export function imageUrl(file: string): string {
  const suffix = accessCode ? `?code=${encodeURIComponent(accessCode)}` : "";
  return `/files/${file}${suffix}`;
}

export function taskImageUrl(url: string): string {
  if (!accessCode) return url;
  return `${url}${url.includes("?") ? "&" : "?"}code=${encodeURIComponent(accessCode)}`;
}
