import { reactive } from "vue";
import * as api from "./api";
import type { AppState, GeneratePayload, HistoryItem, ModelInfo, Task } from "./types";

export type Tab = "create" | "gallery" | "settings";
export type Toast = { id: number; text: string; tone: "info" | "error" | "success" };
export type AssistantMsg = { role: "user" | "assistant"; content: string; images?: string[] };

const TASK_KEY = "mstudio.taskId";

export const state = reactive({
  booted: false,
  bootError: "" as string,
  needAccess: false,
  info: null as AppState | null,
  models: [] as ModelInfo[],
  history: [] as HistoryItem[],
  tab: "create" as Tab,
  task: null as Task | null,
  viewer: null as HistoryItem | null,
  modelPicker: false,
  draft: null as Draft | null,
  toasts: [] as Toast[],
  assistantOpen: false,
  assistantBusy: false,
  assistantMsgs: [] as AssistantMsg[],
  assistantModel: "",
  pendingPrompt: null as string | null,
  magicube: null as api.MagicubeResult | null,
  magicubeBusy: false,
});

export type Draft = {
  prompt: string;
  negativePrompt: string;
  model: string;
  width: number;
  height: number;
  seed: number | null;
  steps: number | null;
  guidance: number | null;
};

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let toastSeq = 0;

export function toast(text: string, tone: Toast["tone"] = "info"): void {
  const id = ++toastSeq;
  state.toasts.push({ id, text, tone });
  setTimeout(() => {
    const idx = state.toasts.findIndex((t) => t.id === id);
    if (idx >= 0) state.toasts.splice(idx, 1);
  }, tone === "error" ? 4200 : 2600);
}

export async function boot(): Promise<void> {
  state.bootError = "";
  try {
    state.info = await api.getState();
    state.models = await api.getModels();
    state.history = await api.getHistory();
    state.needAccess = false;
    const saved = localStorage.getItem(TASK_KEY);
    if (saved && !state.task) void attachTask(saved);
    if (state.info.hasToken) {
      // 启动即查真实魔粒余额（推理令牌即可，无需网页登录）
      void refreshMagicube();
    }
  } catch (err) {
    if (err instanceof api.AccessRequiredError) {
      state.needAccess = true;
    } else {
      state.bootError = err instanceof Error ? err.message : String(err);
    }
  } finally {
    state.booted = true;
  }
}

export async function submitAccessCode(code: string): Promise<void> {
  api.setAccessCode(code);
  await boot();
  if (state.needAccess) toast("访问码不正确", "error");
}

export async function refreshHistory(): Promise<void> {
  try {
    state.history = await api.getHistory();
    if (state.info) {
      state.info.stats.total = state.history.length;
      state.info.stats.today = state.history.filter((h) =>
        h.createdAt.startsWith(new Date().toISOString().slice(0, 10)),
      ).length;
      state.info.stats.favorites = state.history.filter((h) => h.favorite).length;
    }
  } catch {
    /* 静默失败，避免打断创作 */
  }
}

export async function refreshInfo(): Promise<void> {
  try {
    state.info = await api.getState();
  } catch {
    /* ignore */
  }
}

export async function startGeneration(payload: GeneratePayload): Promise<void> {
  try {
    const task = await api.generate(payload);
    state.task = task;
    localStorage.setItem(TASK_KEY, task.id);
    clearPoll();
    schedulePoll();
  } catch (err) {
    if (err instanceof api.AccessRequiredError) {
      state.needAccess = true;
      return;
    }
    toast(err instanceof Error ? err.message : "提交失败", "error");
  }
}

export async function attachTask(id: string): Promise<void> {
  try {
    const task = await api.getTask(id);
    state.task = task;
    if (task.status === "succeeded" || task.status === "failed" || task.status === "canceled") {
      await finishTask(task);
    } else {
      clearPoll();
      schedulePoll();
    }
  } catch {
    localStorage.removeItem(TASK_KEY);
  }
}

export async function cancelGeneration(): Promise<void> {
  const task = state.task;
  if (!task) return;
  try {
    state.task = await api.cancelTask(task.id);
    clearPoll();
    localStorage.removeItem(TASK_KEY);
    toast("已取消这次生成");
  } catch (err) {
    toast(err instanceof Error ? err.message : "取消失败", "error");
  }
}

export function dismissTask(): void {
  state.task = null;
  localStorage.removeItem(TASK_KEY);
}

function clearPoll(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function schedulePoll(): void {
  clearPoll();
  pollTimer = setTimeout(pollOnce, 1200);
}

async function pollOnce(): Promise<void> {
  const task = state.task;
  if (!task) return;
  try {
    const next = await api.getTask(task.id);
    state.task = next;
    if (next.status === "running" || next.status === "queued") {
      schedulePoll();
      return;
    }
    await finishTask(next);
  } catch (err) {
    if (err instanceof api.ApiError && err.status === 404) {
      localStorage.removeItem(TASK_KEY);
      state.task = null;
      return;
    }
    schedulePoll();
  }
}

async function finishTask(task: Task): Promise<void> {
  clearPoll();
  localStorage.removeItem(TASK_KEY);
  if (task.status === "succeeded") {
    await refreshHistory();
    const item = state.history.find((h) => h.id === task.historyId) ?? null;
    if (item) state.viewer = item;
    toast("图片已生成", "success");
    void refreshInfo();
  } else if (task.status === "failed") {
    toast(task.error ?? "生成失败", "error");
  }
}

export function openViewer(item: HistoryItem): void {
  state.viewer = item;
}

export function closeViewer(): void {
  state.viewer = null;
}

export async function removeHistory(item: HistoryItem): Promise<void> {
  try {
    await api.deleteHistory(item.id);
    if (state.viewer?.id === item.id) state.viewer = null;
    await refreshHistory();
    toast("已删除");
  } catch (err) {
    toast(err instanceof Error ? err.message : "删除失败", "error");
  }
}

export async function favorite(item: HistoryItem): Promise<void> {
  try {
    const updated = await api.toggleFavorite(item.id);
    const idx = state.history.findIndex((h) => h.id === updated.id);
    if (idx >= 0) state.history[idx] = updated;
    if (state.viewer?.id === updated.id) state.viewer = updated;
    void refreshInfo();
  } catch (err) {
    toast(err instanceof Error ? err.message : "操作失败", "error");
  }
}

export async function saveImage(item: HistoryItem): Promise<void> {
  const url = api.imageUrl(item.file);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("图片读取失败");
    const blob = await res.blob();
    const file = new File([blob], `${item.id}.${item.file.split(".").pop() ?? "png"}`, {
      type: blob.type || "image/png",
    });
    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean;
      share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
    };
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      await nav.share({ files: [file], title: "魔搭画室", text: item.prompt });
      return;
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 4000);
    toast("已保存到本地", "success");
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    toast("保存失败，可以长按图片保存", "error");
  }
}

export function findModel(id: string): ModelInfo | undefined {
  return state.models.find((m) => m.id === id);
}

// ---------------- 提示词助手 ----------------

export function openAssistant(imageModel: string): void {
  state.assistantModel = imageModel;
  state.assistantOpen = true;
}

export function closeAssistant(): void {
  state.assistantOpen = false;
}

export function clearAssistant(): void {
  if (state.assistantBusy) return;
  state.assistantMsgs = [];
}

export function useAssistantPrompt(text: string): void {
  state.pendingPrompt = text;
  state.assistantOpen = false;
}

export async function assistantSend(
  text: string,
  imageModel: string,
  images?: string[],
): Promise<void> {
  const content = text.trim();
  if (!content || state.assistantBusy) return;
  if (!state.info?.hasToken) {
    toast("还没有配置魔搭 Token，请到设置里填写", "error");
    return;
  }
  state.assistantMsgs.push({
    role: "user",
    content,
    ...(images && images.length ? { images: images.slice(0, 4) } : {}),
  });
  state.assistantBusy = true;
  try {
    const recent = state.assistantMsgs
      .filter((m) => !m.content.startsWith("⚠️"))
      .slice(-24)
      .map((m) => ({ role: m.role, content: m.content }));
    const out = await api.assistantChat(recent, imageModel, images);
    state.assistantMsgs.push({ role: "assistant", content: out.reply });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "助手调用失败";
    state.assistantMsgs.push({ role: "assistant", content: `⚠️ ${msg}` });
    toast(msg, "error");
  } finally {
    state.assistantBusy = false;
  }
}

export function go(tab: Tab): void {
  state.tab = tab;
}

export function reuse(item: HistoryItem): void {
  state.draft = {
    prompt: item.prompt,
    negativePrompt: item.negativePrompt,
    model: item.model,
    width: item.width,
    height: item.height,
    seed: item.seed,
    steps: item.steps,
    guidance: item.guidance,
  };
  state.viewer = null;
  state.tab = "create";
  toast("参数已带入创作页");
}

// ---------------- 魔粒余额（新 /openapi 网关，推理令牌即可） ----------------

export async function refreshMagicube(): Promise<void> {
  if (state.magicubeBusy) return;
  state.magicubeBusy = true;
  try {
    state.magicube = await api.getMagicube();
  } catch {
    state.magicube = { ok: false, error: "查询失败" };
  } finally {
    state.magicubeBusy = false;
  }
}

// ---------------- 系统返回键 ----------------
// 原生返回键先问页面有没有弹层要关（后注册的先关，符合浮层叠放顺序）

type BackHandler = () => boolean;
const backHandlers: BackHandler[] = [];

export function registerBackHandler(handler: BackHandler): void {
  backHandlers.push(handler);
}

export function unregisterBackHandler(handler: BackHandler): void {
  const idx = backHandlers.indexOf(handler);
  if (idx >= 0) backHandlers.splice(idx, 1);
}

export function handleNativeBack(): boolean {
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    if (backHandlers[i]()) return true;
  }
  // 兜底：store 级弹层（未走组件注册的）
  if (state.viewer) {
    state.viewer = null;
    return true;
  }
  if (state.assistantOpen) {
    state.assistantOpen = false;
    return true;
  }
  if (state.modelPicker) {
    state.modelPicker = false;
    return true;
  }
  return false;
}

// 原生层通过 evaluateJavascript 调用，返回 "true" 表示页面已处理
(window as unknown as { MStudioBack?: () => string }).MStudioBack = () =>
  handleNativeBack() ? "true" : "false";
