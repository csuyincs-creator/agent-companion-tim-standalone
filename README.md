# Agent Companion TIM Standalone

一个可独立运行的 TIM（AI 陪伴角色）工作台：桌面上养一只会陪你跑任务的 AI 助手。它是 Agent Companion TIM 的独立版本，只保留可运行的 Standalone 页面及其必要依赖。

> 中南 CSU 工科研究生一枚，非 AI 从业者，热衷探索 AI 落地实践。爱好 Vibe Coding，持续记录。
> 绿泡公号🔍 『清晨方白晓』，一起定期分享好玩的东西。

## 它能做什么

- **TIM 六态角色**：idle / running / needs_input / ready / blocked / extras 六种状态各带动画剪辑，闭眼静态休眠，Hover 唤醒；
- **逐帧精灵动画**：按状态播放不同动作（平板专注、侧向工作、挥手、轻跳、左右观察…），动画帧与节奏可配置；
- **随机互动**：空闲时随机触发「Zzz 小睡」或 Extras 小动作，右上角可一键开关；
- **Effects 特效池**：heart / star / sparkle / music / alert / tear 等 14 种弹出特效，随状态与工具调用自动出现；
- **工作台对话**：输入框、SSE 流式回复、工具调用过程展示（执行命令 / 改文件 / 搜索网页时 TIM 有对应表情）；
- **双 AI Provider**：DeepSeek（对话模式）与 Codex（本地 AI 助手）一键切换；
- **AI 设置抽屉**：图形化配置 Provider 密钥、测试连通性、读取本机 Codex 模型；
- **本地 Gateway**：`/api/ai/*` 同源代理，Provider 密钥只存在服务端，不进入前端页面；
- **安全边界**：只暴露 `/standalone` 页面，服务只监听本机回环地址。

## 启动

环境要求：Node.js 20 或更高版本。

```powershell
npm ci
npm test
npm run demo
```

浏览器打开：

```text
http://127.0.0.1:4173/standalone
```

服务只监听本机回环地址。浏览器通过同源 `/api/ai/*` 调用本地 Gateway；Provider 密钥不会进入前端页面。

## 目录

| 目录 | 用途 |
| --- | --- |
| `apps/demo/` | Standalone 页面、样式和设置抽屉 |
| `packages/core/` | TIM 状态机和事件契约 |
| `packages/web-component/` | 角色组件、动画帧、随机互动和 Effects |
| `packages/tim-workbench/` | 工作台 UI、SSE 和 AI 请求控制 |
| `server/` | DeepSeek/Codex Gateway 与配置存储 |
| `scripts/` | 本地启动服务 |

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/ai/config` | 读取脱敏 AI 配置 |
| `PUT` | `/api/ai/config` | 保存 AI 配置 |
| `POST` | `/api/ai/config/test` | 测试当前配置 |
| `GET` | `/api/ai/codex/models` | 读取本机可用 Codex 模型 |
| `POST` | `/api/ai/run` | 执行一次 AI 请求并返回 SSE |

## 边界

本仓库不包含 Galaxy、星河页面、组件演示、开发候选素材或跨工作区本机交接文档。Codex 当前按单次请求创建会话；连续多轮会话需要由接入方另行设计。
