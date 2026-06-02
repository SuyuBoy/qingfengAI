# 前端模块手册

## 概述

当前仓库是清风研习社的前端模块，纯静态 SPA，部署入口为仓库根目录。

- 根目录 `index.html` 直接承载 React 应用。
- React 是当前保留的前端实现，源码位于 `frontend/`。
- 根目录 `assets/` 和 `js/` 是 React 构建产物资源，用于线上访问。

前端共用 Google OAuth、JWT、本地存储和后端 API，通过 SSE 流式调用 `/api/chat`。

---

## 文件结构

```
index.html             # React 构建产物入口
assets/                # React 构建产物资源
js/
  klinecharts.umd.js   # 股票页运行时加载的 KLineChart UMD
frontend/
  package.json         # React 源码依赖与构建脚本
  vite.config.ts       # React Vite 配置，base="./"
  public/
    js/
      klinecharts.umd.js # KLineChart 静态资源，构建时复制到根目录 js/
  src/
    App.tsx            # 路由、认证、侧边栏、主题、会话入口
    ErrorBoundary.tsx  # React 渲染错误兜底
    api.ts             # API 封装，复用 bili_jwt
    main.tsx           # React 挂载入口
    markdown.ts        # Markdown/表格渲染辅助
    pages/
      LoginPage.tsx    # 登录页
      DynamicsPage.tsx # 动态页
      ChatPage.tsx     # AI 对话页
      StocksPage.tsx   # 股票页
    styles/            # React 样式
.external/
  assistant-ui/        # assistant-ui 组件仓库，用于 React 聊天界面参考/复用
  KLineChart/          # KLineChart 组件仓库，用于金融图表参考/复用
```

---

## 入口与构建

### `index.html`

根入口是 Vite 构建后的 React 页面：

- 加载 Google Sign-In SDK
- 声明 `window.__API_BASE__`
- 引用根目录 `assets/` 下的构建产物
- `<div id="root"></div>` 作为 React 挂载点

### `frontend/package.json`

关键脚本：

| 脚本 | 说明 |
|---|---|
| `npm run build` | TypeScript 检查 + Vite 构建到 `frontend/dist/` |
| `npm run build:github-root` | TypeScript 检查 + Vite 构建到仓库根目录 |

每次修改 React 源码后，需要执行 `npm run build:github-root` 更新根目录构建产物。

---

## React 实现

### `frontend/src/App.tsx`

- 维护 hash 路由：`/login`、`/chat`、`/dynamics`、`/stocks`
- 认证检查：读取 `bili_jwt`，调用 `/api/auth/me`
- 未登录进入登录页，`unpaid` 用户进入锁定页
- 渲染侧边栏、主题切换、最近会话、聊天搜索、管理员爬虫入口

### `frontend/src/api.ts`

- `TOKEN_KEY = "bili_jwt"`，token 存储在 localStorage
- 自动附加 `Authorization: Bearer` 头
- 401 清除 token 并跳转登录
- 403 抛出 "未付费" 错误
- 提供 `api.get()`、`api.post()`、`api.delete()`

### `frontend/src/pages/LoginPage.tsx`

- 加载 Google Sign-In SDK
- 获取 Google Client ID 并缓存到 sessionStorage
- 登录成功后写入 JWT 并进入 `/chat`

### `frontend/src/pages/DynamicsPage.tsx`

- 加载动态列表，支持游标分页
- 支持关键词、文章 ID、日期筛选
- 使用 `marked` 渲染文章 Markdown
- 将 `![img:N]` 转换为后端图片地址

### `frontend/src/pages/ChatPage.tsx`

- 发送消息到 `/api/chat`
- 读取 SSE 流式响应
- 展示 reasoning、工具调用、文章引用和最终回复
- 本地持久化多会话列表和当前会话
- 支持图片粘贴、调试视图、文章弹窗

### `frontend/src/pages/StocksPage.tsx`

- 加载活跃股票列表 `/api/stocks/active`
- 加载清风指数 `/api/stocks/index`
- 加载个股价格 `/api/stocks/prices/:code`
- 运行时从根目录 `js/klinecharts.umd.js` 加载 KLineChart
- 支持指数参数、排序、个股选择、缩放拖拽和十字光标

---

## 维护原则

- 不再保留原生 JS 页面实现。
- React 源码改动后同步构建根目录产物。
- `.external/assistant-ui` 和 `.external/KLineChart` 是外部组件仓库副本，主要用于查阅源码、示例和 API。除非明确要同步或修改外部仓库，不要把业务改动写进 `.external/`。
- 不在本地启动前端服务，按仓库规则只提交并推送远程。
