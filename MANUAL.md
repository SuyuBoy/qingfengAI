# 前端模块手册

## 概述

`page/` 是清风研习社的前端模块，基于 React + Vite + TypeScript + shadcn/ui，通过 GitHub Pages 部署。

主要页面：登录、动态文章、AI 对话、股票看板、Wiki 知识页、个人资料、邮箱验证。

---

## 部署

### GitHub Actions 自动构建

`.github/workflows/react-root.yml` — 推送 `frontend/**` 后自动 npm build + commit 产物。

**不要手动提交构建产物（index.html、assets/）**。

### Git 推送（HTTPS 不稳定时）

```bash
GIT_SSL_NO_VERIFY=1 git push origin main
```

---

## 前端文件结构

```
index.html             # Vite 构建产物入口
assets/                # 构建产物 JS/CSS
frontend/
  src/
    api.ts                 # API 请求封装（fetch + JWT）
    types.ts               # 全局类型定义
    chatStorage.ts         # 本地对话历史持久化（localStorage）
    markdown.ts            # Markdown 渲染配置（rehype-highlight）
    securityAttestation.ts # WebRTC STUN 采集 + 证明获取
    global.d.ts            # 全局类型声明
    main.tsx               # 应用入口 + React Router
    App.tsx                # 路由配置
    styles.css             # 全局样式
    lib/
      utils.ts             # shadcn 工具函数（cn()）
    components/
      ui/                  # shadcn/ui 基础组件
    pages/
      LoginPage.tsx        # 登录/注册（Google OAuth + 邮箱验证码）
      DynamicsPage.tsx     # 动态文章列表 + 全文阅读
      ChatPage.tsx         # AI 对话（SSE 流式）
      StocksPage.tsx       # 股票看板壳
      stocks/
        StockPanel.tsx     # 右侧侧边栏 + 指数卡片
        IndexCard.tsx      # 持仓弹窗（表格：名称/代码/开/收/涨跌/权重）
        ChartContainer.tsx # K线容器（lightweight-charts）
        stockUtils.ts      # 等权聚合、颜色交换等
      WikiPage.tsx         # 知识 wiki 页
      ProfilePage.tsx      # 个人资料 + Token 配额
      VerifyPage.tsx       # 邮箱验证入口
```

### 核心工具模块

| 文件 | 说明 |
|------|------|
| `api.ts` | 封装 fetch，自动附加 JWT、风险证明头部，统一错误处理 |
| `securityAttestation.ts` | 通过 STUN 采集 WebRTC 公网 IP，POST 到 `/api/security/attest` 获取证明 Token |
| `chatStorage.ts` | 对话记录持久化到 localStorage，支持多会话切换 |
| `markdown.ts` | 基于 rehype-highlight + 行号的自定义 Markdown 渲染 |

### 股票页数据流

- 指数日线: `GET /api/stocks/index?period=1d`
- 指数分钟: `GET /api/stocks/index/ohlc`
- 个股 K 线: `GET /api/stocks/prices/{code}`
- 活跃列表: `GET /api/stocks/active`
- 历史持仓: `GET /api/stocks/index/holdings`

---

## 等权 K 线聚合（前端）

1m 数据缓存在浏览器，按周期聚合：
- 5m = 5 根 1m 合并（O=首开，H=max，L=min，C=末收）
- 日线只取 `period=1d` 数据，不过滤 from/to
- 颜色全局交换 `swapUpDownColors`（红涨绿跌）
- 蜡烛样式 `CandleType.CandleSolid`

---

## 安全证明流程

```
页面加载 → securityAttestation.ts
  → 创建 RTCPeerConnection（STUN: stun.l.google.com:19302）
  → 收集 ICE candidate 中的公网 IP
  → POST /api/security/attest {webrtc_ips: [...]}
  → 收到 JWT 证明 Token（10 分钟有效）
  → 后续 /api/chat 请求通过 X-Risk-Attestation 头部传入
```
