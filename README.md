# Agent Companion TIM Standalone

这是 Agent Companion TIM 的独立工作台版本，只保留可运行的 Standalone 页面及其必要依赖：

- TIM 六态角色组件、闭眼静态与 Hover 唤醒；
- 随机互动开关、`Zzz` 和 Extras 特效；
- TIM 工作台、对话输入、SSE 消息与 AI 设置抽屉；
- DeepSeek / Codex 本地 AI Gateway；
- 运行时角色帧和 Effects 素材；
- 只暴露 `/standalone` 的本地演示服务。

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
