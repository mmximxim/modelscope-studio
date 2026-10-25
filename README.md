# 魔搭画室（ModelScope Image Studio）

一个手机端优先的 AI 生图应用：Vue 3 PWA 前端 + 本地 Node 服务端，调用魔搭（ModelScope）API-Inference 的文生图 / 图生图与对话模型。同一套前端有两种载体——电脑 / 手机浏览器当 PWA 用，或打包成 Android APK 离线壳安装。

- 访问令牌只保存在本机服务端（桌面 `data/config.json` / Android 应用私有目录），不进入前端代码与打包产物
- 生成的图片与记录落盘本机，支持收藏、删除、按参数重做
- 异步任务制：服务端提交任务 → 轮询 → 下载图片 → 存历史，前端只轮询本地任务；重启浏览器 / 应用后任务进度不丢

## 功能

- **创作页**：12 个精选模型（文生图 + 图生图编辑，2026-10 验证可用）+ 自定义模型 ID；参考图（图生图：改图、换装、合成、迁移，自动压缩到 1024px）；画幅（1:1 / 3:4 / 4:3 / 9:16 / 16:9）；标准 1K / 高清 1.5K；高级参数（步数 / CFG / 随机种子，默认值取自各模型卡）
- **提示词助手**：基于魔搭多模态对话模型 DeepSeek-V4.1-Flash 优化提示词；系统提示词自动注入当前生图模型的名称、特点与中英文偏好；点「优化当前提示词」会把生图侧已选的参考图一起发给助手看；开启思考模式并自动过滤思考过程；支持多轮对话，回复里的代码块可一键填入提示词
- **生成过程**：卡片式进度（提交 → 绘制 → 下载，显示耗时），可取消；失败给中文原因（401/403/429 等均有对应提示）
- **作品页**：瀑布流画廊、收藏筛选、大图查看器（保存到相册 / Web Share、复制提示词、带入参数重做、二次确认删除）
- **魔粒余额**：设置页与主页角标实时显示可用魔粒（走魔搭 `/openapi` 网关，推理令牌即可；网页登录 Cookie 作后备），接口逆向与集成细节见 `docs/REPORT-magicube-api.md`
- **设置页**：Token 管理、网页登录（Android）、默认模型 / 画幅 / 清晰度、局域网地址展示
- **PWA**：manifest + 图标 + Service Worker（静态资源缓存，断网可打开壳，API 不缓存）

## 快速开始（浏览器 / PWA）

```bash
npm install
npm run build     # 类型检查 + 构建前端
npm start         # 启动服务（默认 http://127.0.0.1:8787）
```

启动后控制台会打印局域网地址（如 `http://192.168.x.x:8787`），手机连同一 Wi-Fi 打开即可，可「添加到主屏幕」当 App 用。

开发模式（前后端热更新）：`npm run dev`

### 配置 Token

1. 到 [魔搭访问令牌页](https://modelscope.cn/my/myaccesstoken) 创建 Token（`ms-` 开头）
2. 打开应用 → 设置 → 粘贴 Token → 「验证并保存」（服务端会先调魔搭验证再落盘）

也可以用环境变量 `MODELSCOPE_API_TOKEN` 代替界面配置。

注意：魔搭 API-Inference 要求账号绑定阿里云并完成实名认证；每日有总调用额度，单模型另有额度。

### 可选环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 服务端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 配置与图片存储目录 |
| `ACCESS_CODE` | 空 | 设置后前端需先输入访问码才能使用（公网暴露时建议开启） |
| `MODELSCOPE_API_TOKEN` | 空 | 服务端 Token（也可在设置页填写） |

## Android 应用

`android/` 是一个无依赖的 WebView 壳（minSdk 26，targetSdk 35，纯 Java）：

- `AssetWebServer` + `ApiHandler`：在应用内 127.0.0.1:8123 起本地 HTTP 服务，复刻 Node 端全部 API（生图、助手、历史、魔粒），前端产物打包进 assets 离线加载
- `LoginActivity`：内嵌 WebView 打开魔搭网页登录（桌面 UA 以保留全部第三方登录方式），登录成功捕获 Cookie 用于查询魔粒余额
- `MagicubeFetcher`：隐藏 1×1 WebView，实时刷新魔粒数据

构建：

```bash
npm run build
cp -r dist/* android/app/src/main/assets/web/   # 前端产物进 Android 资产目录
cd android && ./gradlew assembleDebug           # 产物在 app/build/outputs/apk/
```

发布版自行用 `zipalign` + `apksigner` 签名。

## 架构

```
server/            Node 原生 http 服务（无框架，Node 22+ 可直接跑 TS）
  index.ts         路由 / 静态服务 / 任务编排（提交、轮询、下载、落盘）
  modelscope.ts    魔搭 API 客户端：提交、轮询、下载、额度头、错误映射、对话模型
  catalog.ts       精选模型表（默认参数 / 提示词写法指南 / 魔粒档位）
  store.ts         历史记录（data/history.json）与图片落盘（data/images/）
  config.ts        配置读写（data/config.json）
src/               Vue 3 前端（PWA）
  views/           CreateView / GalleryView / SettingsView
  components/      TabBar / ModelPicker / PromptAssistant / ResultViewer / Icon
  store.ts         全局状态与任务轮询
android/           WebView 壳（内嵌本地服务 + 网页登录 + 魔粒抓取）
public/            manifest、sw.js、图标
scripts/           dev.mjs（前后端联调）、preview.mjs（移动视口截图）、magicube-balance.mjs（余额接口调试）
docs/              REPORT-magicube-api.md（魔粒接口逆向报告）
```

## 隐私与安全

- 访问令牌与网页 Cookie 只存本机服务端，前端与打包产物不含任何凭据
- 生成的图片只落盘本机，不上传第三方
- 单用户本地使用场景设计；不做多用户与并发排队，公网部署务必设置 `ACCESS_CODE`

## 已知边界

- 魔搭返回的图片 URL 是临时的，服务端已在任务成功后立即下载落盘，所以历史图片长期可用
- 模型随时可能上下线，以实际调用报错为准；可用「自定义模型 ID」输入任意模型
- 魔粒余额查询依赖魔搭 `/openapi` 网关，接口非官方公开文档，若失效会自动退回估算/隐藏
