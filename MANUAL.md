# Page 模块手册

## 概述

`page/` 是清风研习社的前端模块，纯静态 SPA，部署在 GitHub Pages。基于原生 JavaScript (ES Module) + Google OAuth，通过 SSE 流式调用后端 API。

---

## 文件结构

```
page/
  index.html          # 入口 HTML，声明 nav + 路由容器
  css/
    base.css          # CSS 变量、nav、容器布局
    login.css         # 登录页样式
    dynamics.css      # 动态列表、卡片、搜索栏样式
    chat.css          # 对话界面、侧边栏、模态窗口样式
  js/
    app.js            # 路由调度 + 认证 + 导航渲染
    api.js            # HTTP 请求封装（fetch + JWT）
    views/
      login.js        # Google 一键登录视图
      dynamics.js     # 动态文章列表视图（搜索、日期筛选、marked 渲染）
      chat.js         # AI 对话视图（SSE 流式、工具侧边栏、Markdown 渲染）
```

---

## 文件说明

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

纯静态文件，直接部署到 GitHub Pages。`index.html` 中 `window.__API_BASE__` 指向 FC 后端地址。
