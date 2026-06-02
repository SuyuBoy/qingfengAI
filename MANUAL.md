# Page 模块手册

## 概述

当前仓库是清风研习社的前端模块，纯静态 SPA，部署在 GitHub Pages。前端同时保留两套界面实现：

- 仓库根目录的原生 JavaScript 实现是默认入口。
- `react/` 路由下是 React 构建产物，源码位于 `frontend/`，功能需要与默认 JS 实现保持一致。

两套实现共用 Google OAuth、JWT、本地存储和后端 API，通过 SSE 流式调用 `/api/chat`。

---

## 文件结构

```
index.html            # 默认 JS 实现入口
css/
  base.css            # 默认 JS 实现：CSS 变量、nav、容器布局
  login.css           # 默认 JS 实现：登录页样式
  dynamics.css        # 默认 JS 实现：动态列表、卡片、搜索栏样式
  chat.css            # 默认 JS 实现：对话界面、侧边栏、模态窗口样式
js/
  app.js              # 默认 JS 实现：路由调度 + 认证 + 导航渲染
  api.js              # 默认 JS 实现：HTTP 请求封装（fetch + JWT）
  views/
    login.js          # 默认 JS 实现：Google 一键登录视图
    dynamics.js       # 默认 JS 实现：动态文章列表视图
    chat.js           # 默认 JS 实现：AI 对话视图
frontend/
  package.json        # React 源码依赖与构建脚本
  vite.config.ts      # React Vite 配置，base="./"
  src/
    App.tsx           # React 路由、认证、侧边栏、主题、会话入口
    api.ts            # React API 封装，复用 bili_jwt
    main.tsx          # React 挂载入口
    markdown.ts       # React 聊天 Markdown/表格渲染辅助
    pages/
      LoginPage.tsx   # React 登录页
      DynamicsPage.tsx # React 动态页
      ChatPage.tsx    # React AI 对话页
      StocksPage.tsx  # React 股票页
    styles/           # React 样式
react/
  index.html          # React 路由下的构建产物入口
  assets/             # React 构建产物资源
.external/
  assistant-ui/       # assistant-ui 组件仓库，用于 React 聊天界面参考/复用
  KLineChart/         # KLineChart 组件仓库，用于 React 金融图表参考/复用
```

---

## 文件说明

下面先记录默认 JS 实现，再记录 `/react/` 路由对应的 React 实现。

### `index.html` — 入口页面

- 加载 GSI（Google Sign-In）SDK
- 声明 `window.__API_BASE__` 指向 FC 后端地址
- 导航栏 `<nav>` 含动态/对话链接、用户邮箱、爬虫按钮、退出按钮
- `<main#app>` 作为 SPA 路由容器
- 退出按钮直接清除 JWT 并跳转登录页

---

### `css/base.css` — 基础样式

CSS 变量定义（暖色衬线风格）：
- 背景 `--bg: #faf9f7`，卡片 `--card-bg: #fff`
- 文字 `--text: #2c2c2c`，弱化 `--muted: #999`
- 边框 `--border: #e8e4df`，标签 `--tag-bg: #f3f0ec`
- 字体：Noto Serif SC / Georgia 衬线栈
- nav 毛玻璃效果（`backdrop-filter: blur`）
- 容器最大宽度 720px，居中

---

### `css/login.css` — 登录页样式

登录卡片居中，包含 h1、说明文字、错误信息区域、Google 登录按钮。

---

### `css/dynamics.css` — 动态列表样式

- 搜索栏（flex 布局，输入框 + 按钮）
- 日期筛选按钮和标签
- 文章卡片（白底边框，hover 阴影）
- 卡片包含 meta（日期 + ID）、content（marked 渲染）、展开全文按钮
- "加载更多" 按钮样式

---

### `css/chat.css` — 对话界面样式

- 聊天气泡（user 右对齐黑底白字，assistant 左对齐白底边框）
- Markdown 渲染样式（h1-h4、表格、代码块、引用块）
- 思考过程折叠块（`.msg-think`）
- 输入区域控制栏（模型选择、effort 选择、轮数、调试/新对话按钮）
- 工具调用侧边栏（320px 固定右侧，可收起/展开）
- 文章模态窗口（居中浮层，max-width 560px）
- 调试模态窗口（max-width 720px，消息列表）
- 粘贴图片预览（缩略图 + 删除按钮）
- 响应式：< 1024px 隐藏侧边栏

---

### `js/api.js` — API 封装

- `TOKEN_KEY = "bili_jwt"`，token 存储在 localStorage
- `setToken()` / `getToken()` / `clearToken()` 管理 token
- `request(path, options)` 统一封装 fetch：
  - 自动附加 `Authorization: Bearer` 头
  - 401 → 清除 token，跳转登录
  - 403 → 抛出 "未付费" 错误
- `api.get(path, params)` / `api.post(path, body)` / `api.delete(path)`

---

### `js/app.js` — 应用入口 + 路由调度

**核心函数：**

| 函数 | 说明 |
|---|---|
| `checkAuth()` | 验证 JWT 有效性，调用 `/api/auth/me` 获取用户信息 |
| `renderNav()` | 渲染导航栏：非 unpaid 用户显示 nav，管理员显示爬虫按钮 |
| `triggerCrawl()` | 管理员触发爬虫，含 60s 冷却 |
| `route()` | hash 路由调度：未登录 → login，unpaid → 锁定页，`#/chat` → chat，默认 → dynamics |

**路由注册：** `hashchange` 事件 + `load` 事件触发 `route()`。

---

### `js/views/login.js` — 登录视图

- 检测 `google.accounts` SDK 是否就绪
- 初始化 GSI：获取 Google Client ID（先读 sessionStorage 缓存，再调 API）
- 配置 `google.accounts.id.initialize` 回调 → 调 `/api/auth/login` → 存 token → reload
- 桌面端自动 `prompt()`（移动端跳过防止遮挡）

---

### `js/views/dynamics.js` — 动态列表视图

**核心函数：**

| 函数 | 说明 |
|---|---|
| `init(container)` | 渲染搜索栏 + 卡片列表，绑定事件 |
| `initialLoad()` | 首次加载（分页，limit=20） |
| `loadMore()` | 加载更多（游标分页） |
| `doSearch()` | 标题关键词搜索（调用 `/api/search`，limit=50） |
| `setDate(d)` | 日期筛选（`date_from` + `date_to` 相同日期） |
| `render()` | 渲染卡片列表（按日期分组，marked 渲染 markdown） |
| `fixImages(content, id)` | 将 `![img:N]` 替换为图片 CDN URL |

**事件处理：** `expand-btn` 点击展开全文（替换 preview 为完整 marked 内容）。

---

### `js/views/chat.js` — AI 对话视图

**核心函数：**

| 函数 | 说明 |
|---|---|
| `init(container)` | 渲染对话界面，绑定输入/发送/清除/调试按钮，渲染历史消息 |
| `sendMessage()` | 发送消息：构造 user 消息 → POST `/api/chat` → SSE 流式读取 |
| `newSession()` | 创建新对话，构造 system prompt（含当前时间 + 工具调用轮数上限） |
| `addMessage(role, content)` | 添加消息气泡到 DOM |
| `simpleMarkdown(text)` | 自研轻量 Markdown → HTML 渲染器（标题、粗斜体、表格、图片） |
| `addToolCard(name, query)` | 在侧边栏添加工具调用卡片 |
| `populateCard(card, articles)` | 填充搜索结果的元信息列表 |
| `showArticleModal(id)` | 模态窗口查看文章全文 |
| `showDebugModal()` | 调试窗口：展示当前 `messages` 数组（role、content、tool_calls、reasoning） |
| `collapseSidebar()` / `expandSidebar()` | 侧边栏收起/展开 |

**SSE 流式处理（sendMessage 内）：**
1. 读取 stream → 按 `\n` 分割 → 解析 `data:` 行
2. `obj.tool/cached` → 添加侧边栏卡片
3. `obj.articles` → 填充卡片文章列表
4. `obj.reasoning` → 累积思考内容
5. `obj.delta` → 累积回答内容
6. `obj.done` → 保存 messages 到 localStorage，更新 `window.__debugMessages`

**消息持久化：** `messages` 数组通过 `localStorage("chat_messages")` 存取，刷新不丢失。

---

## React 路由实现

React 版本源码在 `frontend/`，构建后输出到仓库根目录的 `react/`，线上通过 `/react/` 路由访问。默认 JS 实现仍然是根路径入口，因此 React 改动需要主动执行构建脚本更新 `react/` 产物。

### React 开发原则

- React 路由下的界面尽量少造轮子，优先复用成熟开源组件和本仓库已有组件。
- 聊天界面优先参考和复用 `.external/assistant-ui` / `@assistant-ui/react` 的 primitives、runtime、composer、thread、message 等能力。
- 股票、K 线、金融走势图优先参考和复用 `.external/KLineChart` / `klinecharts`，避免继续手写复杂 canvas、SVG 缩放、十字光标、指标和交互。
- 新增 React 页面时，需要保持默认 JS 实现已有的认证、付费锁定、管理员能力、API 语义和本地存储 key 兼容。
- `.external/assistant-ui` 和 `.external/KLineChart` 是外部组件仓库副本，主要用于查阅源码、示例和 API。除非明确要同步或改外部仓库，不要把业务改动写进 `.external/`。

### `frontend/package.json` — React 依赖和构建脚本

关键依赖：

- `react` / `react-dom`：React 19 前端运行时。
- `@assistant-ui/react`：聊天 thread、message、composer、external store runtime 等组件能力。
- `radix-ui`：通用无障碍 UI primitives。
- `lucide-react`：按钮和导航图标。
- `marked`：动态页 Markdown 渲染。

关键脚本：

| 脚本 | 说明 |
|---|---|
| `npm run build` | TypeScript 检查 + Vite 构建到 `frontend/dist/` |
| `npm run build:react-route` | TypeScript 检查 + Vite 构建到仓库根 `react/` |
| `npm run build:github-root` | 构建 React 并复制到仓库根入口，当前默认入口不是这个模式 |

### `frontend/src/App.tsx` — React 应用入口 + 路由调度

**核心职责：**

| 功能 | 说明 |
|---|---|
| hash 路由 | `#/chat`、`#/dynamics`、`#/stocks`、`#/login`，空 hash 默认进入 `/chat` |
| 认证 | 读取 `bili_jwt`，调用 `/api/auth/me` 获取当前用户 |
| 付费锁定 | `role=unpaid` 时显示锁定页 |
| 侧边栏 | 新聊天、搜索聊天、动态、股票、最近会话、主题切换、退出登录 |
| 管理员能力 | `is_admin` 用户显示刷新爬虫按钮，调用 `/api/crawl` |
| 会话联动 | 通过 `chat-new-session`、`chat-load-session`、`chat-session-deleted` 自定义事件与 `ChatPage` 同步 |

本地存储 key：

- `bili_jwt`：JWT。
- `chat_sessions`：React 多会话列表。
- `chat_active_session`：React 当前会话 ID。
- `qf_theme`：React 明暗主题。

### `frontend/src/api.ts` — React API 封装

- `API_BASE` 优先读取 `window.__API_BASE__`，其次读取 `VITE_API_BASE`。
- 自动附加 `Authorization: Bearer <token>`。
- 请求体是普通对象时自动 JSON 序列化。
- 401 清除 token 并跳转 `#/login`。
- 403 抛出 `"未付费"`。

### `frontend/src/pages/LoginPage.tsx` — React 登录页

- 轮询等待 `window.google.accounts` 就绪。
- 读取或请求 `/api/config/google-client-id`，缓存到 `sessionStorage("google_client_id")`。
- Google 登录回调调用 `/api/auth/login`，成功后保存 `bili_jwt`。
- 桌面端调用 GSI `prompt()`，移动端跳过。

### `frontend/src/pages/DynamicsPage.tsx` — React 动态页

**核心函数：**

| 函数 | 说明 |
|---|---|
| `initialLoad()` | 首次加载 `/api/dynamics`，分页 `limit=20` |
| `loadMore()` | 使用 cursor 继续分页 |
| `doSearch()` | 支持关键词搜索 `/api/search`，也支持直接输入文章 ID 调 `/api/dynamics/{id}` |
| `setDate(date)` | 使用 `date_from` + `date_to` 做单日筛选 |
| `fixImages(content, dynamicId)` | 将 `![img:N]` 替换为 `/api/img/{dynamicId}_{N}` |

动态内容使用 `marked.parse()` 渲染，长文超过 300 字先展示预览，点击展开全文。

### `frontend/src/pages/ChatPage.tsx` — React AI 对话页

React 聊天页已经接入 `@assistant-ui/react`，核心结构是：

- `AssistantRuntimeProvider` 包裹聊天页。
- `useExternalStoreRuntime()` 将本地 `messages` 和 `sendMessage()` 接入 assistant-ui runtime。
- `ThreadPrimitive` / `MessagePrimitive` / `ComposerPrimitive` 负责 thread、消息列表、输入框、滚动到底部等基础交互。
- `Select` 组件用于模型、effort、最大工具轮数等选项。

**核心状态：**

| 状态 | 说明 |
|---|---|
| `messages` | 当前会话消息，保存到 `chat_sessions` |
| `sessions` / `activeSessionId` | 多会话列表和当前会话 |
| `streaming` | SSE 流式状态 |
| `cards` | 工具调用/缓存命中的文章结果卡片 |
| `pastedImages` | 粘贴或上传的图片 base64 |
| `model` / `effort` / `maxRounds` / `debug` | 请求 `/api/chat` 的控制参数 |
| `debugLog` / `cacheStats` | 调试响应和 DeepSeek cache 命中统计 |

**SSE 流式处理：**

1. 发送 `messages`、`model`、`effort`、`max_rounds`、`images`、`debug` 到 `/api/chat`。
2. 逐行解析 `data:`。
3. `debug` / `debug_response` 更新调试日志。
4. `ds_usage` 更新 cache 命中统计。
5. `tool` / `cached` 生成工具调用步骤和右侧活动卡片。
6. `articles` 填充当前工具卡片文章列表。
7. `reasoning` 累积思考步骤。
8. `delta` 累积最终回答。
9. `done.messages` 返回后规范化并持久化最终消息。

### `frontend/src/pages/StocksPage.tsx` — React 股票页

- `/api/stocks/active` 获取活跃标的。
- `/api/stocks/index` 获取清风指数序列和参数元信息。
- `/api/stocks/prices/{order_book_id}` 获取单个标的价格序列。
- 当前图表是手写 SVG 折线图。后续扩展 K 线、缩放、十字光标、指标、移动端图表交互时，应优先使用 `.external/KLineChart` 对应的 `klinecharts` 能力，不要继续扩展自研图表逻辑。

### `frontend/src/markdown.ts` — React 聊天 Markdown 渲染

聊天消息使用轻量渲染函数，支持：

- HTML table 转换。
- Markdown table。
- 标题、引用、粗体、斜体、行内代码、图片、列表、分隔线。

如果后续聊天富文本能力变复杂，优先评估 assistant-ui 生态或成熟 Markdown 组件，不要继续堆叠复杂正则。

---

## 外部组件仓库

### `.external/assistant-ui`

`assistant-ui` 是开源 TypeScript/React AI 聊天 UI 库。当前 React 聊天页已经安装并使用 `@assistant-ui/react`。实现聊天相关功能时优先查阅：

- primitives：`Thread`、`Message`、`Composer`、`ThreadList`、`ActionBar`。
- runtime：`useExternalStoreRuntime`、custom runtime、streaming 接入方式。
- 交互：自动滚动、停止生成、附件、重试、工具调用展示、可访问性。

适用场景：聊天主界面、消息渲染、输入框、附件上传、工具调用展示、多会话 thread 列表、流式状态展示。

### `.external/KLineChart`

`KLineChart` 是基于 HTML5 canvas 的轻量金融图表库，提供 TypeScript 类型、移动端支持、指标和画线能力。实现 React 股票页图表功能时优先查阅：

- K 线、分时、折线等金融图表渲染。
- 缩放、拖拽、十字光标、tooltip、坐标轴。
- 指标、标记、覆盖物、主题样式。
- 移动端触控交互。

适用场景：股票价格走势、K 线图、清风指数走势图、技术指标、金融图表交互。

---

## 认证流程

```
用户访问 → route() → checkAuth() → GET /api/auth/me
  ├── 401（无 token）→ showLogin() → Google GSI → POST /api/auth/login → 存 JWT → reload
  ├── 200 role=unpaid → showLock() → 提示联系管理员
  └── 200 role=paid/admin → renderNav() → 根据 hash 显示页面
```

---

## 调试功能

- **对话调试按钮** (`#chat-debug-btn`)：弹出模态窗口展示当前 `messages` 数组（system prompt + 所有 user/assistant/tool 消息 + reasoning + tool_calls）
- **爬虫按钮** (`.crawl-btn`)：仅 `is_admin` 用户可见，点击触发 `/api/crawl`
- **消息持久化**：`window.__debugMessages` 在每次对话完成后更新

---

## 构建/部署

纯静态文件，直接部署到 GitHub Pages。默认 JS 实现的 `index.html` 中 `window.__API_BASE__` 指向 FC 后端地址。

React 路由构建：

```bash
cd frontend
npm run build:react-route
```

该命令会执行 TypeScript 检查并把产物写入仓库根目录 `react/`，供 `/react/` 路由访问。按当前工作区约定，修改后不要在本地启动前端服务。
