# 魔搭画室（ModelScope Image Studio）

一个手机端优先的 AI 生图应用：Vue 3 PWA 前端 + 本地 Node 服务端，调用魔搭（ModelScope）API-Inference 的文生图能力。

- 手机浏览器打开局域网地址即可使用，可"添加到主屏幕"当 App 用
- 访问令牌只保存在本机服务端（`data/config.json`），不会进入前端或打包产物
- 生成的图片与记录落盘在本机 `data/` 目录，支持收藏、删除、按参数重做
- 异步任务制：服务端提交任务 → 轮询 → 下载图片 → 存历史，前端只轮询本地任务；重启浏览器后任务进度不丢

## 快速开始

```bash
npm install
npm run build     # 类型检查 + 构建前端
npm start         # 启动服务（默认 http://127.0.0.1:8787）
```

启动后控制台会打印局域网地址（如 `http://192.168.x.x:8787`），手机连同一 Wi-Fi 打开即可。

开发模式（前后端热更新）：

```bash
npm run dev
```

### 配置 Token

1. 到 [魔搭访问令牌页](https://modelscope.cn/my/myaccesstoken) 创建 Token（`ms-` 开头）
2. 打开应用 → 设置 → 粘贴 Token → "验证并保存"（服务端会先调魔搭验证再落盘）

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

## 功能

- **创作页**：提示词（灵感按钮 / 风格标签追加 / 负向词）、8 个精选模型 + 自定义模型 ID、画幅（1:1 / 3:4 / 4:3 / 9:16 / 16:9）、标准 1K / 高清 1.5K、高级参数（步数 / CFG / 随机种子，默认值来自各模型卡）
- **提示词助手**：创作页一键打开，基于魔搭多模态对话模型 DeepSeek-V4.1-Flash（文本与带图同一个模型，实测带图约 9 秒）优化提示词；开启思考模式并自动过滤思考过程；系统提示词自动注入当前生图模型的名称、特点与中英文偏好；点"优化当前提示词"会把生图侧已选的参考图一起发给助手看；支持多轮对话，回复里的围栏代码块可一键"填入提示词"
- **生成过程**：卡片式进度（提交 → 绘制 → 下载，显示耗时），可取消；失败给中文原因（401/403/429 等均有对应提示）
- **今日额度**：按本地成功调用数估算剩余次数（魔搭每日上限 2000 次，无官方余额接口），若上游返回实时额度响应头则优先显示
- **作品页**：瀑布流画廊、收藏筛选、大图查看器（保存到相册 / Web Share、复制提示词、带入参数重做、二次确认删除）
- **魔粒余额**：设置页与主页角标实时显示可用魔粒（走魔搭新 `/openapi` 网关，推理令牌即可；网页登录 Cookie 作为后备），接口逆向与集成细节见 `docs/REPORT-magicube-api.md`
- **设置页**：Token 管理、默认模型 / 画幅 / 清晰度、局域网地址展示
- **PWA**：manifest + 图标 + Service Worker（静态资源缓存，断网可打开壳，API 不缓存）

## 架构

```
server/            Node 原生 http 服务（无框架，Node 22+ 可直接跑 TS）
  index.ts         路由 / 静态服务 / 任务编排（提交、轮询、下载、落盘）
  modelscope.ts    魔搭 API 客户端：提交、轮询、下载、额度头、错误映射
  catalog.ts       精选模型表与默认参数
  store.ts         历史记录（data/history.json）与图片落盘（data/images/）
  config.ts        配置读写（data/config.json）
src/               Vue 3 前端（PWA）
  views/           CreateView / GalleryView / SettingsView
  components/      TabBar / ModelPicker / ResultViewer / Icon
  store.ts         全局状态与任务轮询
public/            manifest、sw.js、图标
scripts/           dev.mjs（前后端联调）、preview.mjs（移动视口截图）
```

协议细节（接口、参数范围、错误处理、每模型推荐参数）整理在仓库上级目录的 `docs/modelscope-image-api.md`。

## 已知边界

- 单用户本地使用场景设计；不做多用户与并发排队，公网部署务必设置 `ACCESS_CODE`
- 魔搭返回的图片 URL 是临时的，服务端已在任务成功后立即下载落盘，所以历史图片长期可用
- 模型清单内置精选 8 个（2026-10 验证可用），模型随时可能上下线，以实际调用报错为准；可用"自定义模型 ID"输入任意模型
