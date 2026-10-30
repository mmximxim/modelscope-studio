import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  DATA_DIR,
  DIST_DIR,
  IMAGES_DIR,
  ensureDirs,
  maskToken,
  readConfig,
  resolveAccessCode,
  resolveToken,
  writeConfig,
} from "./config.ts";
import { CURATED_MODELS, inferDefaults, type ModelInfo } from "./catalog.ts";
import {
  MsError,
  chatCompletion,
  downloadImage,
  friendlyError,
  lastQuota,
  pollImageTask,
  probeQuota,
  submitImage,
  verifyToken,
  type ChatMsg,
} from "./modelscope.ts";
import {
  addHistory,
  countToday,
  deleteHistory,
  listHistory,
  saveImage,
  toggleFavorite,
} from "./store.ts";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const VERSION = "0.1.0";
const TASK_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 2500;

type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

function isCanceled(task: { status: TaskStatus }): boolean {
  return task.status === "canceled";
}
type Stage = "submitting" | "generating" | "downloading" | "done";

type LocalTask = {
  id: string;
  status: TaskStatus;
  stage: Stage;
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
};

const tasks = new Map<string, LocalTask>();
const aborters = new Map<string, AbortController>();

// ---------------- 每日用量（魔搭不提供余额接口，本地计数估算） ----------------

const DAILY_LIMIT = 2000;
const USAGE_PATH = path.join(DATA_DIR, "usage.json");
const COOKIE_PATH = path.join(DATA_DIR, "webcookie.txt");
const MAGICUBE_PATH = path.join(DATA_DIR, "magicube.json");
const usage = { date: "", images: 0, chats: 0, magicubes: 0 };
let webCookie = "";

function loadCookie(): void {
  try {
    webCookie = fs.readFileSync(COOKIE_PATH, "utf8").trim();
  } catch {
    webCookie = "";
  }
}

function saveCookie(cookie: string): void {
  webCookie = (cookie ?? "").trim();
  try {
    if (!webCookie) fs.rmSync(COOKIE_PATH, { force: true });
    else fs.writeFileSync(COOKIE_PATH, webCookie);
  } catch {
    /* ignore */
  }
}

async function websiteGet(url: string, cookie?: string, bearer?: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    headers: {
      ...(bearer ? { Authorization: bearer } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36",
      Referer: "https://modelscope.cn/",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.text();
  return { status: res.status, body };
}

function magicubeOk(body: string): boolean {
  try {
    const j = JSON.parse(body) as { success?: boolean; Success?: boolean };
    return j.success === true || j.Success === true;
  } catch {
    return false;
  }
}

function usageDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function rollUsage(): void {
  const today = usageDate();
  if (usage.date !== today) {
    usage.date = today;
    usage.images = 0;
    usage.chats = 0;
  }
}

function loadUsage(): void {
  try {
    const raw = JSON.parse(fs.readFileSync(USAGE_PATH, "utf8")) as typeof usage;
    usage.date = String(raw.date ?? "");
    usage.images = Number(raw.images ?? 0);
    usage.chats = Number(raw.chats ?? 0);
  usage.magicubes = Number(raw.magicubes ?? 0);
  } catch {
    /* 首日无文件 */
  }
  rollUsage();
}

function bumpUsage(kind: "images" | "chats"): void {
  rollUsage();
  usage[kind]++;
  try {
    fs.writeFileSync(USAGE_PATH, JSON.stringify(usage, null, 2));
  } catch {
    /* 忽略写入失败 */
  }
}

function usageJson() {
  rollUsage();
  return { ...usage, total: usage.images + usage.chats, dailyLimit: DAILY_LIMIT };
}

function newId(): string {
  const ts = Date.now().toString(36);
  return `${ts}${randomBytes(4).toString("hex")}`;
}

function publicTask(task: LocalTask) {
  return {
    id: task.id,
    status: task.status,
    stage: task.stage,
    upstreamStatus: task.upstreamStatus,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    model: task.model,
    modelName: task.modelName,
    prompt: task.prompt,
    negativePrompt: task.negativePrompt,
    size: task.size,
    width: task.width,
    height: task.height,
    seed: task.seed,
    steps: task.steps,
    guidance: task.guidance,
    imageUrl: task.imageUrl,
    historyId: task.historyId,
    error: task.error,
    errorStatus: task.errorStatus,
    requestId: task.requestId,
    elapsedMs: (task.finishedAt ?? Date.now()) - (task.startedAt ?? task.createdAt),
  };
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req: http.IncomingMessage, limit = 2 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new MsError("请求体过大", 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new MsError("请求体不是合法 JSON", 400));
      }
    });
    req.on("error", reject);
  });
}

function lanUrls(): string[] {
  const urls: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        urls.push(`http://${net.address}:${PORT}`);
      }
    }
  }
  return urls;
}

function clampSize(raw: unknown, maxSide: number): { size: string; width: number; height: number } {
  const text = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  const match = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/.exec(text);
  if (!match) throw new MsError("尺寸格式应为 宽x高，例如 1024x1024", 400);
  let w = Number(match[1]);
  let h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 64 || h < 64) {
    throw new MsError("尺寸不能小于 64×64", 400);
  }
  w = Math.min(w, maxSide);
  h = Math.min(h, maxSide);
  w = Math.max(64, Math.round(w / 8) * 8);
  h = Math.max(64, Math.round(h / 8) * 8);
  return { size: `${w}x${h}`, width: w, height: h };
}

function findModel(id: string): ModelInfo {
  const curated = CURATED_MODELS.find((m) => m.id === id);
  if (curated) return curated;
  const short = id.split("/").pop() ?? id;
  return {
    id,
    name: short,
    tag: "自定义",
    description: "自定义模型",
    ...inferDefaults(id),
  };
}

async function runTask(task: LocalTask, images?: string[]): Promise<void> {
  const token = resolveToken();
  if (!token) {
    task.status = "failed";
    task.error = "还没有配置魔搭 Token，请到设置里填写";
    task.finishedAt = Date.now();
    return;
  }

  const controller = new AbortController();
  aborters.set(task.id, controller);
  task.status = "running";
  task.stage = "submitting";
  task.startedAt = Date.now();

  try {
    const submitted = await submitImage(
      token,
      {
        model: task.model,
        prompt: task.prompt,
        negativePrompt: task.negativePrompt || undefined,
        size: task.size,
        seed: task.seed ?? undefined,
        steps: task.steps ?? undefined,
        guidance: task.guidance ?? undefined,
        images,
      },
      controller.signal,
    );
    task.requestId = submitted.requestId ?? undefined;
    task.stage = "generating";

    const deadline = Date.now() + TASK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (isCanceled(task)) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (isCanceled(task)) return;

      const poll = await pollImageTask(token, submitted.taskId, controller.signal);
      task.upstreamStatus = poll.rawStatus;

      if (poll.status === "failed") {
        task.status = "failed";
        task.error = poll.error ?? "生成失败";
        task.finishedAt = Date.now();
        return;
      }
      if (poll.status === "succeeded" && poll.imageUrl) {
        task.stage = "downloading";
        const { buffer, ext } = await downloadImage(poll.imageUrl, controller.signal);
        const file = saveImage(task.id, buffer, ext);
        const history = addHistory({
          id: task.id,
          createdAt: new Date(task.createdAt).toISOString(),
          model: task.model,
          modelName: task.modelName,
          prompt: task.prompt,
          negativePrompt: task.negativePrompt,
          size: task.size,
          width: task.width,
          height: task.height,
          seed: task.seed,
          steps: task.steps,
          guidance: task.guidance,
          file,
          elapsedMs: Date.now() - (task.startedAt ?? task.createdAt),
          favorite: false,
        });
        task.status = "succeeded";
        task.stage = "done";
        task.imageUrl = `/files/${file}`;
        task.historyId = history.id;
        task.finishedAt = Date.now();
        bumpUsage("images");
        return;
      }
    }

    task.status = "failed";
    task.error = "生成超时（超过 10 分钟），可以稍后重试";
    task.finishedAt = Date.now();
  } catch (err) {
    if (isCanceled(task)) return;
    const info = friendlyError(err);
    task.status = "failed";
    task.error = info.message;
    task.errorStatus = info.status;
    task.requestId = info.requestId ?? task.requestId;
    task.finishedAt = Date.now();
  } finally {
    aborters.delete(task.id);
  }
}

function requireToken(): string {
  const token = resolveToken();
  if (!token) {
    const err = new MsError("还没有配置魔搭 Token，请到设置里填写", 401);
    (err as MsError & { raw?: boolean }).raw = true;
    throw err;
  }
  return token;
}

/** 构建提示词助手的 system prompt，注入当前生图模型的能力、写法指南与全模型速览 */
function assistantSystemPrompt(imageModel: string): string {
  const id = imageModel.trim();
  const info = id ? findModel(id) : null;
  const low = id.toLowerCase();
  const lang = /flux|krea|ideogram/.test(low)
    ? "该模型更懂英文：最终提示词用英文写，解释文字用中文。"
    : "该模型对中文理解很好：最终提示词用中文写即可。";
  const guidance = info?.guidance;
  const editLine = info?.edit
    ? info.edit.required
      ? `- 该模型是编辑模型，必须配合 ${info.edit.maxImages === 1 ? "1 张" : `1–${info.edit.maxImages} 张`}参考图使用：提示词应描述要对参考图做什么修改、达成什么效果。`
      : `- 该模型支持垫图（最多 ${info.edit.maxImages} 张）：用户附参考图时，提示词应描述想要的修改或效果。`
    : "";
  const guide = info?.guide ? `\n- 提示词写法要点：${info.guide}` : "";
  const overview = CURATED_MODELS.map((m) => `- ${m.id}｜${m.name}｜${m.description}`).join("\n");
  return [
    "你是「魔搭画室」App 内置的生图提示词助手，运行在用户的手机上。",
    "",
    "用户当前选择的生图模型：",
    `- 模型 ID：${id || "未指定"}`,
    `- 名称：${info?.name ?? id ?? "未指定"}`,
    `- 特点：${info?.description ?? ""}`,
    `- 推荐参数：${info?.steps ?? 25} 步、CFG ${guidance === null || guidance === undefined ? "不适用（该模型不使用 CFG）" : guidance}`,
    ...(editLine ? [editLine] : []),
    lang,
    guide,
    "",
    "平台还有这些模型，当用户的想法更适合别的模型时可以推荐并简述理由：",
    overview,
    "",
    "【身份与边界】",
    "- 你只负责写和优化生图提示词。你不能生成、绘制、修改或展示任何图片——生成图片是用户拿你写的提示词去创作页完成的事。",
    "- 任何情况下都不要回答「我无法生成图片」「我做不到」之类的话。用户想要生成图片时，正确回应是直接给他一条能拿去生成的提示词，可顺带说一句「把代码块里的提示词发到创作页即可生成」。",
    "",
    "【收到图片时】",
    "- 先读图，提炼：主体与动作、场景环境、构图与镜头（景别/角度/景深）、光线与色调、风格与媒介、画面中出现的文字。",
    "- 用户想要「同款/类似」→ 写一条复刻该图的文生图提示词：描述可执行的视觉要素，不要写成对图片的赏析点评。",
    "- 用户想「改这张图」且当前模型支持参考图 → 写图生图编辑指令：动词短语说清「把什么改成什么、达到什么效果」，不复述整张图，一次只聚焦一个主要改动，多个改动分多条给。",
    "- 用户发了图但当前模型不支持参考图 → 明确说明这一点，然后把图片要素转写成文生图提示词。",
    "- 意图不明 → 默认按「复刻」方向给一条提示词，结尾用一句话问是否要往编辑方向改。",
    "",
    "【提示词写法】",
    "- 按「主体与动作 → 场景环境 → 构图与镜头 → 光线色调 → 风格与媒介 → 画质」分层描述，重要的信息放前面。",
    "- 具体大于抽象：「黄昏低角度的暖金色侧光」好过「美丽的光线」，「85mm 浅景深」好过「高级感」。",
    "- 风格要锚定到媒介、镜头或流派（胶片摄影/赛博插画/水墨/3D 渲染…），空泛的「好看、精致」没有信息量。",
    "- 负向词仅当确有必要时在代码块外的说明里给出（如「负向词建议：多余的手指、水印、模糊」），不要放进代码块。",
    "- 画面要出现文字时用「」写明原文，并交代位置与载体（如：木招牌上写着「开业大吉」）。",
    "- 不堆砌形容词，一个主体一个场景，每层信息只说一次；用户没给齐的信息用合理默认补全，并在代码块外说明补了什么。",
    "",
    "【输出格式】",
    "1. 最终提示词必须单独放在一个 ``` 围栏代码块里，代码块内只有提示词本身，不要任何前缀、引号或解释。",
    "2. 代码块外用一两句话说明思路或可调整的方向，保持简短，适合手机屏幕阅读。",
    "3. 用户只是聊天或提问就自然回答；一旦给出可用提示词，遵守第 1 条。",
  ]
    .filter(Boolean)
    .join("\n");
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): boolean {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  const safe = path.normalize(rel).replace(/^([/\\])+/, "");
  if (safe.includes("..")) return false;
  let filePath = path.join(DIST_DIR, safe);

  if (!fs.existsSync(filePath)) {
    if (path.extname(safe)) return false;
    filePath = path.join(DIST_DIR, "index.html");
    if (!fs.existsSync(filePath)) {
      const msg = "前端尚未构建：请运行 npm run build，或使用 npm run dev 开发模式。";
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(msg);
      return true;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const immutable = safe.startsWith("assets/");
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function serveImage(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, url: URL): boolean {
  const name = decodeURIComponent(pathname.replace(/^\/files\//, ""));
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) return false;
  const filePath = path.join(IMAGES_DIR, name);
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const etag = `"${stat.size}-${stat.mtimeMs}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304).end();
    return true;
  }
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": "private, max-age=31536000, immutable",
    ETag: etag,
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function accessDenied(res: http.ServerResponse): void {
  json(res, 401, { ok: false, code: "access_required", error: "需要访问码" });
}

function hasAccess(req: http.IncomingMessage, url: URL): boolean {
  const code = resolveAccessCode();
  if (!code) return true;
  const header = req.headers["x-access-code"];
  const provided = typeof header === "string" ? header : url.searchParams.get("code") ?? "";
  return provided === code;
}

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  if (pathname === "/api/state" && method === "GET") {
    const cfg = readConfig();
    const token = resolveToken();
    const history = listHistory(1000);
    json(res, 200, {
      ok: true,
      version: VERSION,
      hasToken: Boolean(token),
      tokenMasked: maskToken(token),
      accessRequired: Boolean(resolveAccessCode()),
      defaultModel: cfg.defaultModel,
      defaultRatio: cfg.defaultRatio,
      defaultQuality: cfg.defaultQuality,
      quota: lastQuota,
      usage: usageJson(),
      stats: {
        total: history.length,
        today: countToday(),
        favorites: history.filter((h) => h.favorite).length,
      },
      server: { port: PORT, urls: lanUrls() },
    });
    return;
  }

  if (!hasAccess(req, url)) {
    accessDenied(res);
    return;
  }

  if (pathname === "/api/models" && method === "GET") {
    const models = CURATED_MODELS.map((m) => ({
      ...m,
      recommendedSize: m.maxSide >= 2048 ? "1024x1024" : `${Math.min(1024, m.maxSide)}x${Math.min(1024, m.maxSide)}`,
    }));
    json(res, 200, { ok: true, models });
    return;
  }

  if (pathname === "/api/config/token" && method === "POST") {
    const body = (await readJson(req)) as { token?: string };
    const token = String(body.token ?? "").trim();
    if (token.length < 8) {
      json(res, 400, { ok: false, error: "Token 看起来不完整，请重新复制" });
      return;
    }
    const valid = await verifyToken(token);
    if (!valid) {
      json(res, 401, { ok: false, error: "Token 无效或已过期，请到魔搭重新创建" });
      return;
    }
    writeConfig({ token });
    json(res, 200, { ok: true, hasToken: true, tokenMasked: maskToken(token) });
    return;
  }

  if (pathname === "/api/config/token" && method === "DELETE") {
    writeConfig({ token: "" });
    json(res, 200, { ok: true, hasToken: false });
    return;
  }

  if (pathname === "/api/config/prefs" && method === "POST") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const patch: Record<string, string> = {};
    if (typeof body.defaultModel === "string" && body.defaultModel.includes("/")) {
      patch.defaultModel = body.defaultModel;
    }
    if (typeof body.defaultRatio === "string" && /^\d{1,2}:\d{1,2}$/.test(body.defaultRatio)) {
      patch.defaultRatio = body.defaultRatio;
    }
    if (body.defaultQuality === "standard" || body.defaultQuality === "high") {
      patch.defaultQuality = body.defaultQuality;
    }
    writeConfig(patch);
    json(res, 200, { ok: true, config: readConfig() });
    return;
  }

  if (pathname === "/api/config/test" && method === "POST") {
    const body = (await readJson(req)) as { token?: string };
    const token = String(body.token ?? "").trim() || requireToken();
    const valid = await verifyToken(token);
    json(res, valid ? 200 : 401, {
      ok: valid,
      error: valid ? undefined : "Token 无效或已过期",
      quota: lastQuota,
    });
    return;
  }

  if (pathname === "/api/quota" && method === "GET") {
    json(res, 200, { ok: true, quota: lastQuota, today: countToday() });
    return;
  }

  // 启动/手动刷新额度：做一次轻量上游调用拿 ratelimit 响应头
  if (pathname === "/api/quota/refresh" && method === "GET") {
    const token = requireToken();
    await probeQuota(token);
    json(res, 200, { ok: true, quota: lastQuota });
    return;
  }

  // 魔粒余额：新 /openapi 网关（Bearer 试探 → Cookie 直连 → 登录时存档）
  if (pathname === "/api/magicube" && method === "GET") {
    const urlBalance = "https://modelscope.cn/openapi/v1/magicubes/balance";
    let ckMain = webCookie;
    let ckWww = webCookie;
    if (webCookie.startsWith("{")) {
      try {
        const saved = JSON.parse(webCookie) as { ms?: string; www?: string; cookie?: string };
        ckMain = saved.ms ?? saved.cookie ?? "";
        ckWww = saved.www ?? saved.cookie ?? "";
      } catch {
        /* 旧格式纯字符串 */
      }
    }
    const token = resolveToken();
    let best: { status: number; body: string } | null = null;
    let auth = "none";
    if (token) {
      const r = await websiteGet(urlBalance, undefined, `Bearer ${token}`);
      if (magicubeOk(r.body)) {
        best = r;
        auth = "token";
      }
    }
    if (!best && ckMain) {
      const r = await websiteGet(urlBalance, ckMain);
      if (magicubeOk(r.body)) {
        best = r;
        auth = "cookie";
      }
    }
    if (!best && ckWww && ckWww !== ckMain) {
      const r = await websiteGet(urlBalance, ckWww);
      if (magicubeOk(r.body)) {
        best = r;
        auth = "cookie-www";
      }
    }
    const out: Record<string, unknown> = { ok: Boolean(best), auth };
    if (best) {
      const body = JSON.parse(best.body) as { data?: unknown };
      out.data = body.data ?? body;
    } else if (fs.existsSync(MAGICUBE_PATH)) {
      // 兜底：登录瞬间抓到的魔方数据
      try {
        const stored = JSON.parse(fs.readFileSync(MAGICUBE_PATH, "utf8")) as { data?: unknown };
        if (stored.data) {
          out.ok = true;
          out.auth = "login-time";
          out.data = stored.data;
        }
      } catch {
        /* ignore */
      }
    }
    if (!out.ok) out.error = "余额查询未授权，请在设置里重新登录魔搭网页版";
    json(res, 200, out);
    return;
  }

  if (pathname === "/api/config/cookie" && method === "POST") {
    const body = (await readJson(req, 24 * 1024 * 1024)) as { cookie?: string; magicubeData?: string };
    const c = String(body.cookie ?? "").trim();
    if (c.length < 10) {
      json(res, 400, { ok: false, error: "Cookie 内容无效" });
      return;
    }
    saveCookie(c);
    const md = String(body.magicubeData ?? "").trim();
    if (md.startsWith("{")) {
      try {
        fs.writeFileSync(MAGICUBE_PATH, md);
      } catch {
        /* ignore */
      }
    }
    json(res, 200, { ok: true, hasCookie: true });
    return;
  }

  if (pathname === "/api/config/cookie" && method === "DELETE") {
    saveCookie("");
    fs.rmSync(MAGICUBE_PATH, { force: true });
    json(res, 200, { ok: true, hasCookie: false });
    return;
  }

  if (pathname === "/api/generate" && method === "POST") {
    const token = requireToken();
    if (!token) return;
    const body = (await readJson(req, 24 * 1024 * 1024)) as Record<string, unknown>;

    const model = String(body.model ?? "").trim();
    if (!model || !model.includes("/")) {
      json(res, 400, { ok: false, error: "请选择一个模型" });
      return;
    }
    const prompt = String(body.prompt ?? "").trim();
    if (!prompt) {
      json(res, 400, { ok: false, error: "提示词不能为空" });
      return;
    }
    if (prompt.length > 2000) {
      json(res, 400, { ok: false, error: "提示词不能超过 2000 字" });
      return;
    }
    const negativePrompt = String(body.negativePrompt ?? "").trim().slice(0, 2000);
    const info = findModel(model);
    const { size, width, height } = clampSize(body.size ?? "1024x1024", info.maxSide);

    // 参考 / 输入图（图生图、编辑）
    let images: string[] = [];
    if (Array.isArray(body.images) && body.images.length > 0) {
      const maxImages = info.edit?.maxImages ?? 0;
      if (maxImages === 0) {
        json(res, 400, { ok: false, error: "该模型不支持参考图，请选编辑类模型" });
        return;
      }
      if (body.images.length > maxImages) {
        json(res, 400, { ok: false, error: `该模型最多 ${maxImages} 张参考图` });
        return;
      }
      images = body.images.map(String);
      for (const img of images) {
        if (!img.startsWith("data:image/")) {
          json(res, 400, { ok: false, error: "参考图格式不正确，请重新选择" });
          return;
        }
        if (img.length > 9_000_000) {
          json(res, 400, { ok: false, error: "参考图太大，请换小一点的图片" });
          return;
        }
      }
    }
    if (info.edit?.required && images.length === 0) {
      json(res, 400, { ok: false, error: "这个模型需要至少 1 张参考图，请先添加" });
      return;
    }

    let seed: number | null = null;
    if (body.seed !== undefined && body.seed !== null && body.seed !== "") {
      const n = Number(body.seed);
      if (!Number.isInteger(n) || n < -1 || n > 2147483647) {
        json(res, 400, { ok: false, error: "种子需为 -1 到 2147483647 的整数" });
        return;
      }
      seed = n;
    }

    let steps: number | null = null;
    if (body.steps !== undefined && body.steps !== null && body.steps !== "") {
      const n = Number(body.steps);
      if (!Number.isInteger(n) || n < 1 || n > 50) {
        json(res, 400, { ok: false, error: "步数需在 1–50 之间" });
        return;
      }
      steps = n;
    }

    let guidance: number | null = null;
    if (body.guidance !== undefined && body.guidance !== null && body.guidance !== "") {
      const n = Number(body.guidance);
      if (!Number.isFinite(n) || n < 1 || n > 20) {
        json(res, 400, { ok: false, error: "引导系数需在 1–20 之间" });
        return;
      }
      guidance = n;
    }

    const task: LocalTask = {
      id: newId(),
      status: "queued",
      stage: "submitting",
      upstreamStatus: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      model,
      modelName: info.name,
      prompt,
      negativePrompt,
      size,
      width,
      height,
      seed,
      steps,
      guidance,
    };
    tasks.set(task.id, task);
    void runTask(task, images.length > 0 ? images : undefined);

    json(res, 200, { ok: true, task: publicTask(task) });
    return;
  }

  if (pathname === "/api/assistant/chat" && method === "POST") {
    const token = requireToken();
    const body = (await readJson(req, 24 * 1024 * 1024)) as {
      messages?: Array<{ role?: string; content?: string }>;
      imageModel?: string;
      chatModel?: string;
      images?: string[];
    };
    const incoming = Array.isArray(body.messages) ? body.messages : [];
    if (incoming.length === 0) {
      json(res, 400, { ok: false, error: "没有对话内容" });
      return;
    }
    // 参考图：让视觉模型看到生图侧选的图
    let images: string[] = [];
    if (Array.isArray(body.images) && body.images.length > 0) {
      images = body.images
        .slice(0, 4)
        .map(String)
        .filter((s) => s.startsWith("data:image/") && s.length <= 9_000_000);
    }
    const sys = assistantSystemPrompt(String(body.imageModel ?? ""));
    const chatMsgs: ChatMsg[] = [
      {
        role: "system",
        content: images.length
          ? `${sys}\n本轮用户附带了参考图，请先看懂参考图的内容，再结合它来打磨提示词。`
          : sys,
      },
    ];
    for (const m of incoming.slice(-24)) {
      const role = m?.role === "assistant" ? "assistant" : "user";
      const content = String(m?.content ?? "").trim();
      if (!content) continue;
      chatMsgs.push({ role, content: content.slice(0, 4000) });
    }
    if (chatMsgs.length <= 1) {
      json(res, 400, { ok: false, error: "没有对话内容" });
      return;
    }
    try {
      const out = await chatCompletion(
        token,
        chatMsgs,
        String(body.chatModel ?? ""),
        images.length ? images : undefined,
      );
      bumpUsage("chats");
      json(res, 200, { ok: true, reply: out.reply, chatModel: out.chatModel });
    } catch (err) {
      const info = friendlyError(err);
      json(res, info.status >= 400 && info.status < 600 ? info.status : 502, {
        ok: false,
        error: info.message,
      });
    }
    return;
  }

  const taskMatch = /^\/api\/tasks\/([a-zA-Z0-9]+)$/.exec(pathname);
  if (taskMatch && method === "GET") {
    const task = tasks.get(taskMatch[1]);
    if (!task) {
      json(res, 404, { ok: false, error: "任务不存在或已过期" });
      return;
    }
    json(res, 200, { ok: true, task: publicTask(task) });
    return;
  }

  const cancelMatch = /^\/api\/tasks\/([a-zA-Z0-9]+)\/cancel$/.exec(pathname);
  if (cancelMatch && method === "POST") {
    const task = tasks.get(cancelMatch[1]);
    if (!task) {
      json(res, 404, { ok: false, error: "任务不存在" });
      return;
    }
    if (task.status === "queued" || task.status === "running") {
      task.status = "canceled";
      task.finishedAt = Date.now();
      aborters.get(task.id)?.abort();
    }
    json(res, 200, { ok: true, task: publicTask(task) });
    return;
  }

  if (pathname === "/api/history" && method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 200) || 200, 1000);
    json(res, 200, { ok: true, items: listHistory(limit) });
    return;
  }

  const historyMatch = /^\/api\/history\/([a-zA-Z0-9]+)$/.exec(pathname);
  if (historyMatch && method === "DELETE") {
    const ok = deleteHistory(historyMatch[1]);
    json(res, ok ? 200 : 404, ok ? { ok: true } : { ok: false, error: "作品不存在" });
    return;
  }

  const favoriteMatch = /^\/api\/history\/([a-zA-Z0-9]+)\/favorite$/.exec(pathname);
  if (favoriteMatch && method === "POST") {
    const item = toggleFavorite(favoriteMatch[1]);
    json(res, item ? 200 : 404, item ? { ok: true, item } : { ok: false, error: "作品不存在" });
    return;
  }

  json(res, 404, { ok: false, error: "接口不存在" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/files/")) {
      if (!hasAccess(req, url)) {
        accessDenied(res);
        return;
      }
      if (serveImage(req, res, url.pathname, url)) return;
      res.writeHead(404).end("not found");
      return;
    }
    if (serveStatic(req, res, url.pathname)) return;
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (err) {
    const info = friendlyError(err);
    if (!res.headersSent) json(res, info.status >= 400 && info.status < 600 ? info.status : 500, { ok: false, error: info.message });
    else res.end();
  }
});

// 清理超过 30 分钟的已完成任务，避免内存堆积
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, task] of tasks) {
    if (task.finishedAt && task.finishedAt < cutoff) tasks.delete(id);
  }
}, 5 * 60 * 1000);

ensureDirs();
loadUsage();
server.listen(PORT, HOST, () => {
  const urls = lanUrls();
  console.log("");
  console.log("  魔搭画室 已启动");
  console.log(`  本机   http://127.0.0.1:${PORT}`);
  for (const u of urls) console.log(`  手机   ${u}`);
  console.log("");
  console.log(`  Token  ${resolveToken() ? "已配置" : "未配置（请打开设置填写）"}`);
  console.log(`  数据   ${path.join(process.cwd(), "data")}`);
  console.log("");
});

function shutdown(): void {
  for (const c of aborters.values()) c.abort();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
