package com.mou.imagestudio;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 把原 Node 版 server 的 API 用 Java 复刻，跑在手机本地。
 * 数据目录：files/data/{config.json, history.json, images/}
 */
final class ApiHandler {

    private static final String BASE = "https://api-inference.modelscope.cn/v1";
    private static final long TASK_TIMEOUT_MS = 10 * 60 * 1000L;
    /** 提示词助手用的对话模型（魔搭 chat/completions，多模态：文本与带图共用） */
    static final String ASSISTANT_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
    /** 带图与纯文本共用同一个多模态模型（实测带图 9s 出结果，第三方 VL 系列 401 不可用） */
    static final String ASSISTANT_VL_MODEL = ASSISTANT_MODEL;
    /** 魔搭 API-Inference 每日免费调用上限（官方 limits 文档） */
    static final int DAILY_LIMIT = 2000;

    private File dataDir;
    private File imagesDir;
    private File configPath;
    private File historyPath;
    private File usagePath;
    private File cookiePath;
    private File magicubePath;
    private String webCookie = "";
    private MagicubeFetcher magicubeFetcher;

    // ---- 每日用量（魔搭不提供余额接口，按模型档位估算魔方消耗） ----
    private int usageImages;
    private int usageChats;
    private double usageMagicubes;
    private String usageDate = "";

    private final Map<String, Task> tasks = new ConcurrentHashMap<>();
    private final ExecutorService taskPool = Executors.newFixedThreadPool(2);
    private final Object historyLock = new Object();

    // ---- 配置 ----
    private String token = "";
    private String defaultModel = "Tongyi-MAI/Z-Image-Turbo";
    private String defaultRatio = "1:1";
    private String defaultQuality = "standard";

    // ---- 额度 ----
    private volatile JSONObject quota = null;

    static class Task {
        String id;
        volatile String status = "queued"; // queued running succeeded failed canceled
        volatile String stage = "submitting";
        volatile String upstreamStatus;
        final long createdAt = System.currentTimeMillis();
        volatile long startedAt;
        volatile long finishedAt;
        String model;
        String modelName;
        double cost = 1;
        String prompt;
        String negativePrompt;
        String size;
        int width;
        int height;
        Integer seed;
        Integer steps;
        Double guidance;
        volatile String imageUrl;
        volatile String error;
        volatile Integer errorStatus;
    }

    File imagesDir() {
        return imagesDir;
    }

    void init(File dataDir) throws IOException {
        this.dataDir = dataDir;
        this.imagesDir = new File(dataDir, "images");
        this.configPath = new File(dataDir, "config.json");
        this.historyPath = new File(dataDir, "history.json");
        this.usagePath = new File(dataDir, "usage.json");
        this.cookiePath = new File(dataDir, "webcookie.txt");
        this.magicubePath = new File(dataDir, "magicube.json");
        imagesDir.mkdirs();
        loadConfig();
        loadUsage();
        loadCookie();
    }

    private void loadCookie() {
        try {
            webCookie = new String(readFile(cookiePath), StandardCharsets.UTF_8).trim();
        } catch (Exception ignored) {
            webCookie = "";
        }
    }

    void setMagicubeFetcher(MagicubeFetcher fetcher) {
        this.magicubeFetcher = fetcher;
    }

    private synchronized void saveCookie(String cookie) {
        webCookie = cookie == null ? "" : cookie.trim();
        try {
            if (webCookie.isEmpty()) cookiePath.delete();
            else writeAtomically(cookiePath, webCookie.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
        }
    }

    private void loadConfig() {
        try {
            JSONObject cfg = new JSONObject(new String(readFile(configPath), StandardCharsets.UTF_8));
            token = cfg.optString("token", "");
            defaultModel = cfg.optString("defaultModel", defaultModel);
            defaultRatio = cfg.optString("defaultRatio", defaultRatio);
            defaultQuality = cfg.optString("defaultQuality", defaultQuality);
        } catch (Exception ignored) {
        }
    }

    private synchronized void saveConfig() {
        try {
            JSONObject cfg = new JSONObject();
            cfg.put("token", token);
            cfg.put("defaultModel", defaultModel);
            cfg.put("defaultRatio", defaultRatio);
            cfg.put("defaultQuality", defaultQuality);
            writeAtomically(configPath, cfg.toString(2).getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
        }
    }

    // ---------------- 每日用量 ----------------

    private void loadUsage() {
        try {
            JSONObject u = new JSONObject(new String(readFile(usagePath), StandardCharsets.UTF_8));
            usageDate = u.optString("date", "");
            usageImages = u.optInt("images", 0);
            usageChats = u.optInt("chats", 0);
            usageMagicubes = u.optDouble("magicubes", 0);
        } catch (Exception ignored) {
        }
        rollUsage();
    }

    private void rollUsage() {
        String today = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                .format(new java.util.Date());
        if (!today.equals(usageDate)) {
            usageDate = today;
            usageImages = 0;
            usageChats = 0;
            usageMagicubes = 0;
        }
    }

    private synchronized void addUsage(double magicubes, boolean image) {
        rollUsage();
        if (image) usageImages++;
        else usageChats++;
        usageMagicubes += magicubes;
        try {
            JSONObject u = new JSONObject()
                    .put("date", usageDate)
                    .put("images", usageImages)
                    .put("chats", usageChats)
                    .put("magicubes", Math.round(usageMagicubes * 10) / 10.0);
            writeAtomically(usagePath, u.toString(2).getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
        }
    }

    private JSONObject usageJson() {
        rollUsage();
        try {
            return new JSONObject()
                    .put("images", usageImages)
                    .put("chats", usageChats)
                    .put("total", usageImages + usageChats)
                    .put("magicubes", Math.round(usageMagicubes * 10) / 10.0)
                    .put("dailyLimit", DAILY_LIMIT);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    // ---------------- HTTP 入口 ----------------

    byte[] handle(String method, String path, byte[] body, int[] statusOut) {
        try {
            JSONObject req = body.length == 0 ? new JSONObject() : new JSONObject(new String(body, StandardCharsets.UTF_8));
            if (path.equals("/api/state") && method.equals("GET")) {
                JSONArray history = readHistory();
                JSONObject stats = new JSONObject()
                        .put("total", history.length())
                        .put("today", countToday(history))
                        .put("favorites", countFav(history));
                JSONObject server = new JSONObject().put("port", 8123).put("urls", new JSONArray());
                JSONObject state = new JSONObject()
                        .put("ok", true)
                        .put("version", "1.0")
                        .put("hasToken", !token.isEmpty())
                        .put("tokenMasked", maskToken())
                        .put("accessRequired", false)
                        .put("defaultModel", defaultModel)
                        .put("defaultRatio", defaultRatio)
                        .put("defaultQuality", defaultQuality)
                        .put("quota", quota == null ? JSONObject.NULL : quota)
                        .put("usage", usageJson())
                        .put("webLogin", true)
                        .put("hasCookie", !webCookie.isEmpty())
                        .put("stats", stats)
                        .put("server", server);
                statusOut[0] = 200;
                return state.toString().getBytes(StandardCharsets.UTF_8);
            }

            switch (match(method, path)) {
                case "GET /api/models": {
                    JSONArray models = new JSONArray(readAsset("models.json"));
                    statusOut[0] = 200;
                    return new JSONObject().put("ok", true).put("models", models).toString()
                            .getBytes(StandardCharsets.UTF_8);
                }
                case "POST /api/config/token": {
                    String t = req.optString("token", "").trim();
                    if (t.length() < 8) return err(400, "Token 看起来不完整，请重新复制", statusOut);
                    int code = upstreamStatus("GET", BASE + "/models", t, null, null, false);
                    if (code == 401 || code == 403) return err(401, "Token 无效或已过期，请到魔搭重新创建", statusOut);
                    if (code != 200 && code != 0 && code != 404) {
                        return err(502, "验证时连接魔搭失败（HTTP " + code + "），请检查网络", statusOut);
                    }
                    token = t;
                    saveConfig();
                    JSONObject ok = new JSONObject().put("ok", true).put("hasToken", true)
                            .put("tokenMasked", maskToken());
                    statusOut[0] = 200;
                    return ok.toString().getBytes(StandardCharsets.UTF_8);
                }
                case "DELETE /api/config/token": {
                    token = "";
                    saveConfig();
                    statusOut[0] = 200;
                    return new JSONObject().put("ok", true).put("hasToken", false).toString()
                            .getBytes(StandardCharsets.UTF_8);
                }
                case "POST /api/config/prefs": {
                    if (req.has("defaultModel") && req.optString("defaultModel").contains("/"))
                        defaultModel = req.optString("defaultModel");
                    if (req.has("defaultRatio") && req.optString("defaultRatio").matches("\\d{1,2}:\\d{1,2}"))
                        defaultRatio = req.optString("defaultRatio");
                    if (req.has("defaultQuality") && (req.optString("defaultQuality").equals("standard")
                            || req.optString("defaultQuality").equals("high")))
                        defaultQuality = req.optString("defaultQuality");
                    saveConfig();
                    statusOut[0] = 200;
                    return new JSONObject().put("ok", true).toString().getBytes(StandardCharsets.UTF_8);
                }
                case "POST /api/config/test": {
                    String t = req.optString("token", "").trim().isEmpty() ? token : req.optString("token").trim();
                    if (t.isEmpty()) return err(401, "还没有配置 Token", statusOut);
                    int code = upstreamStatus("GET", BASE + "/models", t, null, null, false);
                    JSONObject ok = new JSONObject().put("ok", code == 200);
                    if (code != 200) ok.put("error", "Token 无效或已过期（HTTP " + code + "）");
                    statusOut[0] = code == 200 ? 200 : 401;
                    return ok.toString().getBytes(StandardCharsets.UTF_8);
                }
                case "POST /api/generate": {
                    if (token.isEmpty()) return err(401, "还没有配置魔搭 Token，请到设置里填写", statusOut);
                    String model = req.optString("model", "").trim();
                    String prompt = req.optString("prompt", "").trim();
                    if (!model.contains("/")) return err(400, "请选择一个模型", statusOut);
                    if (prompt.isEmpty()) return err(400, "提示词不能为空", statusOut);
                    if (prompt.length() > 2000) return err(400, "提示词不能超过 2000 字", statusOut);

                    JSONObject limits = modelLimits(model);
                    int maxSide = limits.getInt("maxSide");
                    String sizeRaw = req.optString("size", "1024x1024");
                    int[] wh = parseSize(sizeRaw, maxSide);

                    // 参考 / 输入图（图生图、编辑）
                    JSONArray imgsIn = req.optJSONArray("images");
                    int imgCount = imgsIn == null ? 0 : imgsIn.length();
                    JSONObject edit = limits.optJSONObject("edit");
                    int maxImages = edit == null ? 0 : edit.optInt("maxImages", 0);
                    boolean editRequired = edit != null && edit.optBoolean("required", false);
                    String[] refImages = null;
                    if (imgCount > 0) {
                        if (maxImages == 0) return err(400, "该模型不支持参考图，请选编辑类模型", statusOut);
                        if (imgCount > maxImages) return err(400, "该模型最多 " + maxImages + " 张参考图", statusOut);
                        refImages = new String[imgCount];
                        for (int i = 0; i < imgCount; i++) {
                            String data = imgsIn.optString(i, "");
                            if (!data.startsWith("data:image/")) return err(400, "参考图格式不正确，请重新选择", statusOut);
                            if (data.length() > 9_000_000) return err(400, "参考图太大，请换小一点的图片", statusOut);
                            refImages[i] = data;
                        }
                    }
                    if (editRequired && imgCount == 0) {
                        return err(400, "这个模型需要至少 1 张参考图，请先添加", statusOut);
                    }

                    Task task = new Task();
                    task.id = UUID.randomUUID().toString().replace("-", "").substring(0, 18);
                    task.model = model;
                    task.cost = limits.optDouble("cost", 1);
                    task.modelName = limits.optString("name", model.substring(model.indexOf('/') + 1));
                    task.prompt = prompt;
                    task.negativePrompt = req.optString("negativePrompt", "").trim();
                    task.size = wh[0] + "x" + wh[1];
                    task.width = wh[0];
                    task.height = wh[1];
                    if (req.has("seed") && !req.isNull("seed") && req.optString("seed").length() > 0) {
                        task.seed = Integer.parseInt(req.optString("seed"));
                    }
                    if (req.has("steps") && !req.isNull("steps") && req.optString("steps").length() > 0) {
                        task.steps = Integer.parseInt(req.optString("steps"));
                    }
                    if (req.has("guidance") && !req.isNull("guidance") && req.optString("guidance").length() > 0) {
                        task.guidance = Double.parseDouble(req.optString("guidance"));
                    }
                    tasks.put(task.id, task);
                    final String[] refs = refImages;
                    taskPool.execute(() -> runTask(task, refs));
                    statusOut[0] = 200;
                    return new JSONObject().put("ok", true).put("task", taskJson(task)).toString()
                            .getBytes(StandardCharsets.UTF_8);
                }
                case "POST /api/assistant/chat": {
                    if (token.isEmpty()) return err(401, "还没有配置魔搭 Token，请到设置里填写", statusOut);
                    JSONArray msgs = req.optJSONArray("messages");
                    if (msgs == null || msgs.length() == 0) return err(400, "没有对话内容", statusOut);
                    String chatModel = req.optString("chatModel", "").trim();

                    // 参考图：让视觉模型看到生图侧选的图
                    JSONArray imgsIn = req.optJSONArray("images");
                    boolean vision = imgsIn != null && imgsIn.length() > 0;
                    if (vision) {
                        if (imgsIn.length() > 4) return err(400, "参考图最多 4 张", statusOut);
                        for (int i = 0; i < imgsIn.length(); i++) {
                            String d = imgsIn.optString(i, "");
                            if (!d.startsWith("data:image/") || d.length() > 9_000_000) {
                                return err(400, "参考图格式不正确，请重新添加", statusOut);
                            }
                        }
                        if (chatModel.isEmpty()) chatModel = ASSISTANT_VL_MODEL;
                    }
                    if (chatModel.isEmpty()) chatModel = ASSISTANT_MODEL;

                    String sys = assistantSystemPrompt(req.optString("imageModel", ""));
                    if (vision) {
                        sys = sys + "\n本轮用户附带了参考图，请先看懂参考图的内容，再结合它来打磨提示词。";
                    }
                    JSONArray chatMsgs = new JSONArray();
                    chatMsgs.put(new JSONObject().put("role", "system").put("content", sys));
                    int count = Math.min(msgs.length(), 24);
                    for (int i = msgs.length() - count; i < msgs.length(); i++) {
                        JSONObject m = msgs.optJSONObject(i);
                        if (m == null) continue;
                        String role = m.optString("role", "user");
                        if (!role.equals("user") && !role.equals("assistant")) continue;
                        String content = m.optString("content", "").trim();
                        if (content.isEmpty()) continue;
                        if (content.length() > 4000) content = content.substring(0, 4000);
                        chatMsgs.put(new JSONObject().put("role", role).put("content", content));
                    }
                    if (chatMsgs.length() <= 1) return err(400, "没有对话内容", statusOut);

                    // 把图挂到最后一条用户消息（OpenAI 视觉格式）
                    if (vision) {
                        for (int i = chatMsgs.length() - 1; i >= 0; i--) {
                            JSONObject m = chatMsgs.optJSONObject(i);
                            if (m == null || !"user".equals(m.optString("role"))) continue;
                            JSONArray content = new JSONArray();
                            content.put(new JSONObject().put("type", "text")
                                    .put("text", m.optString("content", "")));
                            for (int k = 0; k < imgsIn.length(); k++) {
                                content.put(new JSONObject().put("type", "image_url")
                                        .put("image_url", new JSONObject().put("url", imgsIn.optString(k))));
                            }
                            chatMsgs.put(i, new JSONObject().put("role", "user").put("content", content));
                            break;
                        }
                    }

                    // 先尝试开启思考（质量更好）；模型不认识该参数返回 400 时退回普通请求
                    HttpResult r = null;
                    for (int attempt = 0; attempt < 2; attempt++) {
                        JSONObject chatBody = new JSONObject()
                                .put("model", chatModel)
                                .put("messages", chatMsgs)
                                .put("stream", false)
                                .put("temperature", 0.8)
                                .put("max_tokens", 4000);
                        if (attempt == 0) chatBody.put("enable_thinking", true);
                        r = upstream("POST", BASE + "/chat/completions", token,
                                chatBody.toString().getBytes(StandardCharsets.UTF_8), null, false);
                        if (r.status != 400) break;
                    }
                    if (r.status != 200) {
                        String raw = bodyMessage(r);
                        return err(r.status >= 400 && r.status < 600 ? r.status : 502,
                                assistantFriendly(r.status, raw), statusOut);
                    }
                    String reply = "";
                    JSONArray choices = new JSONObject(r.body).optJSONArray("choices");
                    if (choices != null && choices.length() > 0) {
                        JSONObject msg0 = choices.optJSONObject(0);
                        if (msg0 != null) {
                            JSONObject message = msg0.optJSONObject("message");
                            if (message != null) reply = message.optString("content", "");
                        }
                    }
                    reply = reply.replaceAll("(?s)<think>.*?</think>", "").trim();
                    if (reply.isEmpty()) return err(502, "助手没有返回内容，稍后再试", statusOut);
                    addUsage(0.5, false);
                    statusOut[0] = 200;
                    return new JSONObject().put("ok", true).put("reply", reply)
                            .put("chatModel", chatModel).toString().getBytes(StandardCharsets.UTF_8);
                }
                case "GET /api/quota/refresh": {
                    if (token.isEmpty()) return err(401, "还没有配置魔搭 Token，请到设置里填写", statusOut);
                    // 轻量上游调用：响应头里带 ratelimit 余额
                    upstream("GET", BASE + "/models", token, null, null, false);
                    statusOut[0] = 200;
                    return new JSONObject().put("ok", true)
                            .put("quota", quota == null ? JSONObject.NULL : quota)
                            .toString().getBytes(StandardCharsets.UTF_8);
                }
                case "GET /api/magicube": {
                    // 魔粒余额：新 /openapi 网关（与老 /api/v1 完全隔离，无 WAF 指纹拦截）
                    // 回退链：Bearer 令牌试探 → 网页 Cookie 服务端直连 → 隐藏 WebView 同源 → 登录时存档
                    String urlBalance = "https://modelscope.cn/openapi/v1/magicubes/balance";
                    String ckMain = webCookie, ckWww = webCookie;
                    if (webCookie.startsWith("{")) {
                        try {
                            JSONObject saved = new JSONObject(webCookie);
                            ckMain = saved.optString("ms", saved.optString("cookie", ""));
                            ckWww = saved.optString("www", saved.optString("cookie", ""));
                        } catch (Exception ignored) {
                        }
                    }
                    HttpResult best = null;
                    String auth = "none";
                    HttpResult last = null;
                    if (!token.isEmpty()) {
                        last = websiteGet(urlBalance, null, "Bearer " + token);
                        if (openapiOk(last)) {
                            best = last;
                            auth = "token";
                        }
                    }
                    if (best == null && !ckMain.isEmpty()) {
                        last = websiteGet(urlBalance, ckMain, null);
                        if (openapiOk(last)) {
                            best = last;
                            auth = "cookie";
                        }
                    }
                    if (best == null && !ckWww.isEmpty() && !ckWww.equals(ckMain)) {
                        last = websiteGet(urlBalance, ckWww, null);
                        if (openapiOk(last)) {
                            best = last;
                            auth = "cookie-www";
                        }
                    }
                    if (best == null && magicubeFetcher != null) {
                        String raw = magicubeFetcher.fetchMagicubeJson();
                        if (raw != null && !raw.isEmpty()) {
                            last = new HttpResult();
                            last.status = 200;
                            last.body = raw;
                            if (openapiOk(last)) {
                                best = last;
                                auth = "webview";
                            }
                        }
                    }
                    JSONObject out = new JSONObject();
                    out.put("ok", best != null);
                    out.put("auth", auth);
                    if (best != null) {
                        JSONObject respBody = new JSONObject(best.body);
                        out.put("data", respBody.has("data") ? respBody.get("data") : respBody);
                    } else if (magicubePath.exists()) {
                        // 兜底：登录瞬间抓到的魔方数据
                        try {
                            JSONObject stored = new JSONObject(new String(readFile(magicubePath), StandardCharsets.UTF_8));
                            if (stored.has("data")) {
                                out.put("ok", true);
                                out.put("auth", "login-time");
                                out.put("data", stored.get("data"));
                            }
                        } catch (Exception ignored) {
                        }
                    }
                    if (!out.optBoolean("ok")) {
                        out.put("error", last == null ? "未配置任何凭证" : "余额查询未授权，请在设置里重新登录魔搭网页版");
                        if (last != null) {
                            out.put("rawStatus", last.status);
                            out.put("raw", last.body.length() > 200 ? last.body.substring(0, 200) : last.body);
                        }
                    }
                    statusOut[0] = 200;
                    return out.toString().getBytes(StandardCharsets.UTF_8);
                }
                case "POST /api/config/cookie": {
                    String c = req.optString("cookie", "").trim();
                    if (c.length() < 10) return err(400, "Cookie 内容无效", statusOut);
                    saveCookie(c);
                    // 登录瞬间同源 fetch 到的魔方数据一并存下（后续实时查询失败时兜底显示）
                    String md = req.optString("magicubeData", "").trim();
                    if (md.startsWith("{")) {
                        try {
                            writeAtomically(magicubePath, md.getBytes(StandardCharsets.UTF_8));
                        } catch (Exception ignored) {
                        }
                    }
                    statusOut[0] = 200;
                    return new JSONObject().put("ok", true).put("hasCookie", true).toString()
                            .getBytes(StandardCharsets.UTF_8);
                }
                case "DELETE /api/config/cookie": {
                    saveCookie("");
                    try {
                        magicubePath.delete();
                    } catch (Exception ignored) {
                    }
                    statusOut[0] = 200;
                    return new JSONObject().put("ok", true).put("hasCookie", false).toString()
                            .getBytes(StandardCharsets.UTF_8);
                }
            }

            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("^/api/tasks/([a-zA-Z0-9]+)(/cancel)?$")
                    .matcher(path);
            if (m.matches()) {
                Task task = tasks.get(m.group(1));
                if (task == null) return err(404, "任务不存在或已过期", statusOut);
                if (m.group(2) != null && (task.status.equals("queued") || task.status.equals("running"))) {
                    task.status = "canceled";
                    task.finishedAt = System.currentTimeMillis();
                }
                statusOut[0] = 200;
                return new JSONObject().put("ok", true).put("task", taskJson(task)).toString()
                        .getBytes(StandardCharsets.UTF_8);
            }

            if (path.equals("/api/history") && method.equals("GET")) {
                statusOut[0] = 200;
                return new JSONObject().put("ok", true).put("items", readHistory()).toString()
                        .getBytes(StandardCharsets.UTF_8);
            }

            java.util.regex.Matcher hm = java.util.regex.Pattern
                    .compile("^/api/history/([a-zA-Z0-9]+)(/favorite)?$")
                    .matcher(path);
            if (hm.matches()) {
                String id = hm.group(1);
                boolean isFav = hm.group(2) != null;
                JSONObject updated = method.equals("DELETE") ? deleteHistory(id)
                        : isFav ? toggleFavorite(id) : null;
                if (updated == null) return err(404, "作品不存在", statusOut);
                statusOut[0] = 200;
                return (method.equals("DELETE") ? new JSONObject().put("ok", true) : new JSONObject().put("ok", true).put("item", updated))
                        .toString().getBytes(StandardCharsets.UTF_8);
            }

            return err(404, "接口不存在", statusOut);
        } catch (Exception e) {
            return err(500, "服务内部错误: " + e.getMessage(), statusOut);
        }
    }

    private static String match(String method, String path) {
        return method + " " + path;
    }

    private byte[] err(int status, String message, int[] statusOut) {
        statusOut[0] = status;
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false).put("error", message);
        } catch (Exception ignored) {
        }
        return o.toString().getBytes(StandardCharsets.UTF_8);
    }

    private String maskToken() {
        if (token.isEmpty()) return "";
        if (token.length() <= 10) return token.substring(0, 2) + "••••";
        return token.substring(0, 5) + "••••••" + token.substring(token.length() - 4);
    }

    // ---------------- 生成任务 ----------------

    private void runTask(Task task, String[] refImages) {
        task.status = "running";
        task.startedAt = System.currentTimeMillis();
        try {
            JSONObject body = new JSONObject();
            body.put("model", task.model);
            body.put("prompt", task.prompt);
            if (!task.negativePrompt.isEmpty()) body.put("negative_prompt", task.negativePrompt);
            body.put("size", task.size);
            if (task.seed != null) body.put("seed", task.seed);
            if (task.steps != null) body.put("steps", task.steps);
            if (task.guidance != null) body.put("guidance", task.guidance);
            if (refImages != null && refImages.length > 0) {
                JSONArray urlArr = new JSONArray();
                for (String img : refImages) urlArr.put(img);
                body.put("image_url", urlArr);
            }

            HttpResult submit = upstream("POST", BASE + "/images/generations", token,
                    body.toString().getBytes(StandardCharsets.UTF_8), null, true);
            task.upstreamStatus = String.valueOf(submit.status);
            if (submit.status != 200) {
                fail(task, friendly(submit.status, bodyMessage(submit)));
                return;
            }
            String upstreamTaskId = new JSONObject(submit.body).optString("task_id", "");
            if (upstreamTaskId.isEmpty()) {
                fail(task, "魔搭没有返回 task_id");
                return;
            }
            task.stage = "generating";

            long deadline = System.currentTimeMillis() + TASK_TIMEOUT_MS;
            while (System.currentTimeMillis() < deadline) {
                Thread.sleep(2500);
                if (task.status.equals("canceled")) return;

                HttpResult poll = upstream("GET", BASE + "/tasks/" + upstreamTaskId, token, null,
                        "image_generation", false);
                if (poll.status != 200) continue;
                JSONObject data = new JSONObject(poll.body);
                String st = data.optString("task_status", "").toUpperCase();
                task.upstreamStatus = st;
                if (st.equals("SUCCEED") || st.equals("SUCCEEDED")) {
                    String url = null;
                    JSONArray imgs = data.optJSONArray("output_images");
                    if (imgs != null && imgs.length() > 0) url = imgs.optString(0);
                    if (url == null || url.isEmpty()) {
                        fail(task, "任务成功但没有返回图片地址");
                        return;
                    }
                    task.stage = "downloading";
                    HttpResult img = upstream("GET", url, null, null, null, false);
                    if (img.status != 200) {
                        fail(task, "下载图片失败（HTTP " + img.status + "）");
                        return;
                    }
                    String ext = img.contentType != null && img.contentType.contains("jpeg") ? "jpg"
                            : img.contentType != null && img.contentType.contains("webp") ? "webp" : "png";
                    File file = new File(imagesDir, task.id + "." + ext);
                    writeAtomically(file, img.bytes);

                    JSONObject item = new JSONObject();
                    item.put("id", task.id);
                    item.put("createdAt", new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss",
                            java.util.Locale.US).format(new java.util.Date()));
                    item.put("model", task.model);
                    item.put("modelName", task.modelName);
                    item.put("prompt", task.prompt);
                    item.put("negativePrompt", task.negativePrompt);
                    item.put("size", task.size);
                    item.put("width", task.width);
                    item.put("height", task.height);
                    item.put("seed", task.seed == null ? JSONObject.NULL : task.seed);
                    item.put("steps", task.steps == null ? JSONObject.NULL : task.steps);
                    item.put("guidance", task.guidance == null ? JSONObject.NULL : task.guidance);
                    item.put("file", file.getName());
                    item.put("elapsedMs", System.currentTimeMillis() - task.startedAt);
                    item.put("favorite", false);
                    appendHistory(item);

                    task.status = "succeeded";
                    task.stage = "done";
                    task.imageUrl = "/files/" + file.getName();
                    task.finishedAt = System.currentTimeMillis();
                    addUsage(task.cost, true);
                    return;
                }
                if (st.equals("FAILED") || st.equals("FAIL") || st.equals("ERROR")) {
                    String msg = "生成失败";
                    JSONObject errors = data.optJSONObject("errors");
                    if (errors != null) msg = errors.optString("message", msg);
                    fail(task, msg);
                    return;
                }
            }
            fail(task, "生成超时（超过 10 分钟），可以稍后重试");
        } catch (Exception e) {
            if (!task.status.equals("canceled")) fail(task, "连接魔搭失败，请检查网络: " + e.getMessage());
        }
    }

    private void fail(Task task, String message) {
        task.status = "failed";
        task.error = message;
        task.finishedAt = System.currentTimeMillis();
    }

    private static String bodyMessage(HttpResult r) {
        try {
            JSONObject o = new JSONObject(r.body);
            JSONObject errors = o.optJSONObject("errors");
            if (errors != null) return errors.optString("message", "");
            return o.optString("message", "");
        } catch (Exception e) {
            return "";
        }
    }

    private static String friendly(int status, String raw) {
        switch (status) {
            case 400: return "请求参数不被接受，试着简化提示词或换一组参数" + (raw.isEmpty() ? "" : "（" + raw + "）");
            case 401: return "Token 无效或已过期，请到设置里重新填写";
            case 403: return "账号未完成绑定或实名认证，请到魔搭完成后再试";
            case 404: return "该模型当前不可用，换一个模型试试";
            case 429: return "额度或并发已到上限，稍后再试或换模型";
            case 500: return "魔搭服务端出错，稍后重试";
            default: return "请求失败（HTTP " + status + "）" + (raw.isEmpty() ? "" : "：" + raw);
        }
    }

    private JSONObject modelLimits(String id) {
        try {
            JSONArray models = new JSONArray(readAsset("models.json"));
            for (int i = 0; i < models.length(); i++) {
                JSONObject m = models.getJSONObject(i);
                if (m.optString("id").equals(id)) return m;
            }
        } catch (Exception ignored) {
        }
        JSONObject fallback = new JSONObject();
        try {
            fallback.put("id", id);
            fallback.put("name", id.contains("/") ? id.substring(id.indexOf('/') + 1) : id);
            fallback.put("maxSide", 2048);
            fallback.put("steps", 25);
            fallback.put("guidance", JSONObject.NULL);
        } catch (Exception ignored) {
        }
        return fallback;
    }

    /** 构建提示词助手的 system prompt，注入当前生图模型的能力、写法指南与全模型速览 */
    private String assistantSystemPrompt(String imageModel) {
        JSONObject m = (imageModel == null || imageModel.isEmpty()) ? null : modelLimits(imageModel);
        String name = m == null ? "" : m.optString("name", "");
        String desc = m == null ? "" : m.optString("description", "");
        String guide = m == null ? "" : m.optString("guide", "");
        String id = imageModel == null ? "" : imageModel;
        if (name.isEmpty()) name = id.isEmpty() ? "未指定" : id;
        int steps = m == null ? 25 : m.optInt("steps", 25);
        String guidance = (m == null || m.isNull("guidance"))
                ? "不适用（该模型不使用 CFG）"
                : String.valueOf(m.optDouble("guidance"));
        String low = id.toLowerCase();
        String lang = (low.contains("flux") || low.contains("krea") || low.contains("ideogram"))
                ? "该模型更懂英文：最终提示词用英文写，解释文字用中文。"
                : "该模型对中文理解很好：最终提示词用中文写即可。";
        JSONObject edit = m == null ? null : m.optJSONObject("edit");
        String editLine = "";
        if (edit != null) {
            int mx = edit.optInt("maxImages", 1);
            editLine = edit.optBoolean("required", false)
                    ? "- 该模型是编辑模型，必须配合 " + (mx == 1 ? "1 张" : "1–" + mx + " 张") + "参考图使用：提示词应描述要对参考图做什么修改、达成什么效果。\n"
                    : "- 该模型支持垫图（最多 " + mx + " 张）：用户附参考图时，提示词应描述想要的修改或效果。\n";
        }
        StringBuilder overview = new StringBuilder();
        try {
            JSONArray models = new JSONArray(readAsset("models.json"));
            for (int i = 0; i < models.length(); i++) {
                JSONObject mo = models.optJSONObject(i);
                if (mo == null) continue;
                overview.append("- ").append(mo.optString("id", ""))
                        .append("｜").append(mo.optString("name", ""))
                        .append("｜").append(mo.optString("description", "")).append("\n");
            }
        } catch (Exception ignored) {
        }
        return "你是「魔搭画室」App 内置的生图提示词助手，运行在用户的手机上。\n"
                + "\n"
                + "用户当前选择的生图模型：\n"
                + "- 模型 ID：" + id + "\n"
                + "- 名称：" + name + "\n"
                + "- 特点：" + desc + "\n"
                + "- 推荐参数：" + steps + " 步、CFG " + guidance + "\n"
                + editLine
                + lang + "\n"
                + (guide.isEmpty() ? "" : "- 提示词写法要点：" + guide + "\n")
                + "\n"
                + "平台还有这些模型，当用户的想法更适合别的模型时可以推荐并简述理由：\n"
                + overview
                + "\n"
                + "【身份与边界】\n"
                + "- 你只负责写和优化生图提示词。你不能生成、绘制、修改或展示任何图片——生成图片是用户拿你写的提示词去创作页完成的事。\n"
                + "- 任何情况下都不要回答「我无法生成图片」「我做不到」之类的话。用户想要生成图片时，正确回应是直接给他一条能拿去生成的提示词，"
                + "可顺带说一句「把代码块里的提示词发到创作页即可生成」。\n"
                + "\n"
                + "【收到图片时】\n"
                + "- 先读图，提炼：主体与动作、场景环境、构图与镜头（景别/角度/景深）、光线与色调、风格与媒介、画面中出现的文字。\n"
                + "- 用户想要「同款/类似」→ 写一条复刻该图的文生图提示词：描述可执行的视觉要素，不要写成对图片的赏析点评。\n"
                + "- 用户想「改这张图」且当前模型支持参考图 → 写图生图编辑指令：动词短语说清「把什么改成什么、达到什么效果」，"
                + "不复述整张图，一次只聚焦一个主要改动，多个改动分多条给。\n"
                + "- 用户发了图但当前模型不支持参考图 → 明确说明这一点，然后把图片要素转写成文生图提示词。\n"
                + "- 意图不明 → 默认按「复刻」方向给一条提示词，结尾用一句话问是否要往编辑方向改。\n"
                + "\n"
                + "【提示词写法】\n"
                + "- 按「主体与动作 → 场景环境 → 构图与镜头 → 光线色调 → 风格与媒介 → 画质」分层描述，重要的信息放前面。\n"
                + "- 具体大于抽象：「黄昏低角度的暖金色侧光」好过「美丽的光线」，「85mm 浅景深」好过「高级感」。\n"
                + "- 风格要锚定到媒介、镜头或流派（胶片摄影/赛博插画/水墨/3D 渲染…），空泛的「好看、精致」没有信息量。\n"
                + "- 负向词仅当确有必要时在代码块外的说明里给出（如「负向词建议：多余的手指、水印、模糊」），不要放进代码块。\n"
                + "- 画面要出现文字时用「」写明原文，并交代位置与载体（如：木招牌上写着「开业大吉」）。\n"
                + "- 不堆砌形容词，一个主体一个场景，每层信息只说一次；用户没给齐的信息用合理默认补全，并在代码块外说明补了什么。\n"
                + "\n"
                + "【输出格式】\n"
                + "1. 最终提示词必须单独放在一个 ``` 围栏代码块里，代码块内只有提示词本身，不要任何前缀、引号或解释。\n"
                + "2. 代码块外用一两句话说明思路或可调整的方向，保持简短，适合手机屏幕阅读。\n"
                + "3. 用户只是聊天或提问就自然回答；一旦给出可用提示词，遵守第 1 条。";
    }

    /** 访问 modelscope.cn 网站域接口（与推理 API 不同域，鉴权方式不同） */
    private HttpResult websiteGet(String url, String cookie, String bearer) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setRequestMethod("GET");
        if (bearer != null) conn.setRequestProperty("Authorization", bearer);
        if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
        // 模拟浏览器同源请求的头（网站 API 校验 Origin/Referer）
        conn.setRequestProperty("User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
        conn.setRequestProperty("Accept", "application/json, text/plain, */*");
        conn.setRequestProperty("Origin", "https://modelscope.cn");
        conn.setRequestProperty("Referer", "https://modelscope.cn/");
        conn.setRequestProperty("x-modelscope-accept-language", "zh-cn");
        int status = conn.getResponseCode();
        InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        if (in != null) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            in.close();
        }
        conn.disconnect();
        HttpResult r = new HttpResult();
        r.status = status;
        r.bytes = bos.toByteArray();
        r.body = bos.toString("UTF-8");
        return r;
    }

    private static boolean magicubeOk(HttpResult r) {
        try {
            return new JSONObject(r.body).optBoolean("Success", false);
        } catch (Exception e) {
            return false;
        }
    }

    /** 新 /openapi 网关的响应判定：success === true */
    private static boolean openapiOk(HttpResult r) {
        try {
            return new JSONObject(r.body).optBoolean("success", false);
        } catch (Exception e) {
            return false;
        }
    }

    private static String assistantFriendly(int status, String raw) {
        String suffix = raw.isEmpty() ? "" : "（" + raw + "）";
        switch (status) {
            case 400: return "助手请求被拒绝" + suffix;
            case 401: return "Token 无效或已过期，请到设置里重新填写（HTTP 401" + (raw.isEmpty() ? "" : "：" + raw) + "）";
            case 403: return "账号未完成绑定或实名认证，请到魔搭完成后再试（HTTP 403" + (raw.isEmpty() ? "" : "：" + raw) + "）";
            case 404: return "对话模型当前不可用，稍后再试" + suffix;
            case 429: return "额度或并发已到上限，稍后再试";
            default: return "助手调用失败（HTTP " + status + "）" + (raw.isEmpty() ? "" : "：" + raw);
        }
    }

    private static int[] parseSize(String raw, int maxSide) {
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("^(\\d{2,5})\\s*[x×*]\\s*(\\d{2,5})$").matcher(raw.trim().toLowerCase());
        if (!m.matches()) throw new IllegalArgumentException("尺寸格式应为 宽x高");
        int w = Math.min(Integer.parseInt(m.group(1)), maxSide);
        int h = Math.min(Integer.parseInt(m.group(2)), maxSide);
        w = Math.max(64, (w / 8) * 8);
        h = Math.max(64, (h / 8) * 8);
        return new int[]{w, h};
    }

    private JSONObject taskJson(Task t) {
        JSONObject o = new JSONObject();
        try {
            o.put("id", t.id);
            o.put("status", t.status);
            o.put("stage", t.stage);
            o.put("upstreamStatus", t.upstreamStatus == null ? JSONObject.NULL : t.upstreamStatus);
            o.put("createdAt", t.createdAt);
            o.put("startedAt", t.startedAt);
            o.put("finishedAt", t.finishedAt);
            o.put("model", t.model);
            o.put("modelName", t.modelName);
            o.put("prompt", t.prompt);
            o.put("negativePrompt", t.negativePrompt);
            o.put("size", t.size);
            o.put("width", t.width);
            o.put("height", t.height);
            o.put("seed", t.seed == null ? JSONObject.NULL : t.seed);
            o.put("steps", t.steps == null ? JSONObject.NULL : t.steps);
            o.put("guidance", t.guidance == null ? JSONObject.NULL : t.guidance);
            o.put("imageUrl", t.imageUrl == null ? JSONObject.NULL : t.imageUrl);
            o.put("error", t.error == null ? JSONObject.NULL : t.error);
            o.put("elapsedMs", (t.finishedAt > 0 ? t.finishedAt : System.currentTimeMillis())
                    - (t.startedAt > 0 ? t.startedAt : t.createdAt));
        } catch (Exception ignored) {
        }
        return o;
    }

    // ---------------- 历史 ----------------

    private JSONArray readHistory() {
        synchronized (historyLock) {
            try {
                return new JSONArray(new String(readFile(historyPath), StandardCharsets.UTF_8));
            } catch (Exception e) {
                return new JSONArray();
            }
        }
    }

    private void appendHistory(JSONObject item) throws Exception {
        synchronized (historyLock) {
            JSONArray arr = readHistory();
            arr.put(item);
            writeAtomically(historyPath, arr.toString(2).getBytes(StandardCharsets.UTF_8));
        }
    }

    private int countToday(JSONArray history) {
        String today = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US)
                .format(new java.util.Date());
        int n = 0;
        for (int i = 0; i < history.length(); i++) {
            if (history.optJSONObject(i) != null
                    && history.optJSONObject(i).optString("createdAt", "").startsWith(today)) n++;
        }
        return n;
    }

    private int countFav(JSONArray history) {
        int n = 0;
        for (int i = 0; i < history.length(); i++) {
            JSONObject o = history.optJSONObject(i);
            if (o != null && o.optBoolean("favorite")) n++;
        }
        return n;
    }

    private JSONObject toggleFavorite(String id) throws Exception {
        synchronized (historyLock) {
            JSONArray arr = readHistory();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null && id.equals(o.optString("id"))) {
                    o.put("favorite", !o.optBoolean("favorite"));
                    writeAtomically(historyPath, arr.toString(2).getBytes(StandardCharsets.UTF_8));
                    return o;
                }
            }
            return null;
        }
    }

    private JSONObject deleteHistory(String id) throws Exception {
        synchronized (historyLock) {
            JSONArray arr = readHistory();
            JSONArray next = new JSONArray();
            boolean removed = false;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null && id.equals(o.optString("id"))) {
                    new File(imagesDir, o.optString("file")).delete();
                    removed = true;
                } else if (o != null) {
                    next.put(o);
                }
            }
            if (removed) writeAtomically(historyPath, next.toString(2).getBytes(StandardCharsets.UTF_8));
            return removed ? new JSONObject() : null;
        }
    }

    // ---------------- 上游 ----------------

    static class HttpResult {
        int status;
        String body;
        byte[] bytes;
        String contentType;
    }

    private HttpResult upstream(String method, String url, String bearer, byte[] body,
            String taskType, boolean asyncMode) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(120000);
        conn.setRequestMethod(method);
        if (bearer != null) conn.setRequestProperty("Authorization", "Bearer " + bearer);
        if (taskType != null) conn.setRequestProperty("X-ModelScope-Task-Type", taskType);
        if (body != null) {
            conn.setRequestProperty("Content-Type", "application/json");
            if (asyncMode) conn.setRequestProperty("X-ModelScope-Async-Mode", "true");
            conn.setDoOutput(true);
            try (OutputStream out = conn.getOutputStream()) {
                out.write(body);
            }
        }
        int status = conn.getResponseCode();
        captureQuota(conn);
        InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        if (in != null) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            in.close();
        }
        conn.disconnect();
        HttpResult r = new HttpResult();
        r.status = status;
        r.bytes = bos.toByteArray();
        r.body = bos.toString("UTF-8");
        r.contentType = conn.getContentType();
        return r;
    }

    private int upstreamStatus(String method, String url, String bearer, byte[] body,
            String taskType, boolean asyncMode) {
        try {
            return upstream(method, url, bearer, body, taskType, asyncMode).status;
        } catch (IOException e) {
            return 0;
        }
    }

    private void captureQuota(HttpURLConnection conn) {
        try {
            JSONObject q = new JSONObject();
            putLong(q, "totalLimit", header(conn, "modelscope-ratelimit-requests-limit"));
            putLong(q, "totalRemaining", header(conn, "modelscope-ratelimit-requests-remaining"));
            putLong(q, "modelLimit", header(conn, "modelscope-ratelimit-model-requests-limit"));
            putLong(q, "modelRemaining", header(conn, "modelscope-ratelimit-model-requests-remaining"));
            boolean any = q.has("totalLimit") || q.has("totalRemaining")
                    || q.has("modelLimit") || q.has("modelRemaining");
            if (any) {
                q.put("updatedAt", System.currentTimeMillis());
                quota = q;
            }
        } catch (Exception ignored) {
        }
    }

    private static void putLong(JSONObject o, String key, Long v) throws Exception {
        if (v != null) o.put(key, v);
    }

    private static Long header(HttpURLConnection conn, String name) {
        String v = conn.getHeaderField(name);
        if (v == null) return null;
        try {
            return Long.parseLong(v.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // ---------------- IO ----------------

    private static byte[] readFile(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        }
    }

    private static void writeAtomically(File f, byte[] bytes) {
        try {
            f.getParentFile().mkdirs();
            File tmp = new File(f.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(bytes);
            }
            tmp.renameTo(f);
        } catch (IOException ignored) {
        }
    }

    private String readAsset(String name) throws IOException {
        InputStream in = MainActivity.ASSETS.open(name);
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        in.close();
        return bos.toString("UTF-8");
    }
}
