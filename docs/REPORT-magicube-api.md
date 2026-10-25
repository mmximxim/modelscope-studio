# ModelScope（魔搭）魔粒/魔方余额接口逆向与 App 集成 — 最终报告

**结论：可行，接口已完全定位并已集成进「魔搭画室」。**
余额接口位于**新的 `/openapi` 网关**，与老的 `/api/v1` 完全隔离——这就是此前 `/api/v1/users/magicube` 各种姿势都 400/`{}` 的根本原因：方向从一开始就是错的。

> 调研时间：2026-10-24 ~ 10-25 · App 版本：魔搭画室（com.mou.imagestudio）
> 前置研究：`docs/modelscope-image-api.md`（生图协议与参数实测）

---

## 1. 接口清单（新 /openapi 网关）

| 用途 | 方法 | URL | Query 参数 |
|---|---|---|---|
| **余额** | GET | `https://modelscope.cn/openapi/v1/magicubes/balance` | 无 |
| 流水记录 | GET | `.../openapi/v1/magicubes/transactions` | `type`（发放为 `earn`；消耗值未实测，推测 `spend`）、`category_key`、`page`、`page_size` |
| 赚魔粒规则 | GET | `.../openapi/v1/magicubes/earn/rules` | 无 |
| 消耗费率表 | GET | `.../openapi/v1/magicubes/spend/rates` | 前端透传（即官方文档的成本表） |

- 备用主机：`www.modelscope.cn/openapi/v1/...` 同样有效；`modelscope.ai/openapi/...` 部署了同款网关。
- 路径是复数 **magicubes**，前缀 **/openapi/v1**。此前 400 的 `GET /api/v1/users/magicube` 是老网关的无关端点。
- POST/PUT/DELETE 到 balance → 404；`/magicubes/summary`、`/magicubes/me` → 404。

## 2. 鉴权

| 凭证 | 新 /openapi 网关 | 说明 |
|---|---|---|
| 网页登录 Cookie | ✅（首选） | 与网站同一会话；社区 NodeLoc 自动领魔粒脚本即服务端带 `MODELSCOPE_COOKIE` 调用，实证可行 |
| `Authorization: Bearer ms-xxx` | ⚠️ 待验证 | 官方前端无 Bearer 逻辑；但 modelscope.ai 的 API-Inference 本就是 Bearer 体系，App 里已实现为第一优先级试探 |
| GET 的 CSRF | 不需要 | 官方 `traceFetch` 仅在 POST/PUT/DELETE 时带 `X-CSRF-TOKEN` |

请求头参考：

```http
GET /openapi/v1/magicubes/balance HTTP/1.1
Host: modelscope.cn
Accept: application/json
Cookie: <网页登录 Cookie>
X-ModelScope-Accept-Language: zh-CN        # 可选
X-ModelScope-Trace-Id: <UUID>              # 可选，回显为 request_id
```

网关不校验 User-Agent（curl / Node undici 均可达，**无老 /api/v1 的 TLS 指纹拦截**）。

## 3. 响应结构

匿名 401：

```json
{ "success": false, "code": "InvalidAuthentication", "message": "authentication required", "request_id": "..." }
```

成功（字段名来自官方前端解构代码 `aigc-PT1RHCkR.js`：`e?.total_balance || 0`、`e?.available_balance || 0`）：

```json
{ "success": true, "request_id": "...", "data": { "total_balance": 200, "available_balance": 150 } }
```

网关响应头：`X-Powered-By: ModelScope-Gateway`、`X-Modelscope-Api-Name: GetBalance`、`X-Modelscope-Api-Version: 20260413`。
CORS 回显任意 Origin 且 `Allow-Credentials: true`（浏览器 SameSite 制约，不作首选通道）。

## 4. 发现路径（复盘）

1. 旧 SPA 桌面/H5 主包（umi.js）均无 magicube 字样 → 主包之外。
2. 页面 shell 中 `window.MODELSCOPE_WEB_PROXY_URL` 含 `/magicube/usage` → 独立的 React Router v7 新应用（`cdn.modelscope.cn/static/assets/`），页面标题「我的魔粒」。
3. 其路由模块 `aigc-PT1RHCkR.js` 的 `useMagicCube`：`axios.get('/v1/magicubes/balance', { baseURL: origin + '/openapi' })`。
4. 旧 SPA 全部 395 个 chunk 交叉验证：头部组件 `layouts__index.async.js`（全站 Magic Cube 按钮）调同一接口；umi.js 请求层有 `new F("/openapi")` 实例。
5. 匿名探测：balance/transactions/earn-rules/spend-rates 均 401（端点存在）；summary/me 404。
6. 社区佐证：nssnap 教程、NodeLoc 脚本、npm `dsh-plugin-model-usage-meter` 均使用同一端点。
7. 官方 Python SDK 无 magicube 封装（负结果）。
8. **弯路记录**：老 `/api/v1/users/magicube` 匿名 400「获取用户信息失败」、登录态 400、服务端带 Cookie 400、WebView 同源 fetch 返回 `{}` —— 因为它根本不是余额接口。期间的 CDP 抓包（Chrome 远程调试 WebView）是定位「网站自身请求也 400」这一关键事实的手段。

## 5. App 集成（魔搭画室）

查询链（`/api/magicube`，双端实现）：

1. `Bearer ms-xxx` 试探新网关（若通则免 Cookie）；
2. **网页 Cookie 服务端直连**（首选，登录时自动捕获、存 `data/webcookie.txt`）；
3. 隐藏 1×1 WebView 同源 fetch（`MagicubeFetcher`，共享 CookieManager）；
4. 登录瞬间抓取的存档（`data/magicube.json`，登录成功那一刻的同源 fetch 响应）；
5. 全部失败 → 按模型档位估算的今日消耗（见下）。

设置页「魔方余额」卡片展示 `累计魔粒 / 可用魔粒`；「登录魔搭网页版」按钮打开原生 WebView 登录（桌面版 UA，含全部第三方登录方式），登录成功自动捕获 Cookie 与余额数据并存本机。

**魔方消耗估算**（无实时数据时的口径）：按官方档位给每个模型标 cost（轻量 0.5 / 标准 1 / 重型 2），每次成功调用加权累计，展示「今日魔方（估算）」。调用次数（2000 次/日官方上限）单独一行。

## 6. 已验证 / 未验证

**已验证（匿名/代码层）**
- 新网关端点存在性与 401 行为（cn / www / ai 三主机）
- GET-only 路由、404 变体、CORS 全开放、OPTIONS 预检
- curl 与 Node undici 直连可达（无 TLS 指纹拦截）
- 官方两套前端的调用代码与响应字段名（静态分析交叉验证）

**已验证（真实登录态，2026-10-25 App 实测）** ✅
- **`Authorization: Bearer ms-xxx` 在新网关可用**（cn 域）——推理令牌直接查余额，无需网页 Cookie；App 回退链第一级即命中（`auth:"token"`）
- 成功响应完整结构：`{"success":true,"data":{"total_balance":50,"available_balance":50,"frozen_amount":0}}`（比静态分析多一个 `frozen_amount`）
- 实测余额 50 魔粒，与「绑阿里云每日 +50」规则吻合

**待验证（低优先级）**
1. 消耗统计 tab 的 `type` 值（推测 `spend`）
2. Cookie 会话的有效期（Bearer 路径已不需要 Cookie，仅作后备）
3. modelscope.ai 国际站网关的 Bearer 行为差异

## 7. 相关文件

- 报告：`docs/REPORT-magicube-api.md`（本文件）
- Node 直连示例：`scripts/magicube-balance.mjs`（`MAGICSCOPE_COOKIE='...' node scripts/magicube-balance.mjs`）
- CDP 诊断脚本（WebView 调试抓包，复用价值高）：`scripts/cdp-diag.cjs`、`scripts/cdp-api-capture.cjs`、`scripts/cdp-dom-probe2.cjs`
- App 查询实现：`android/.../ApiHandler.java`（`GET /api/magicube`）、`android/.../MagicubeFetcher.java`、`android/.../LoginActivity.java`、`server/index.ts`
