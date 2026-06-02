# 清风研习社 — 前端开发手册 (给 AI 用)

本文档供 AI 编写新前端时使用。包含所有 API 端点、认证流程、请求/响应格式的完整说明。

---

## 1. 基本信息

| 项目 | 值 |
|---|---|
| 项目名称 | 清风研习社 — B站动态存档 + AI 对话 |
| API 生产地址 | `https://qingfenapiflask-tanwdgitwa.cn-hangzhou.fcapp.run` |
| API 本地端口 | `9000` |
| 前端部署 | GitHub Pages |
| 认证方式 | Google OAuth + JWT |
| JWT 存储 key | `bili_jwt` (localStorage) |

### API 地址设置

前端通过 `window.__API_BASE__` 全局变量设置 API 基础地址。没有设置时默认为空（同源请求）。

```html
<script>
  window.__API_BASE__ = "https://qingfenapiflask-tanwdgitwa.cn-hangzhou.fcapp.run";
</script>
```

所有 API 请求路径拼接方式: `fetch(API_BASE + "/api/xxx")`

---

## 2. 认证流程

### 2.1 登录流程

```
用户进入页面
  → 检测 localStorage 是否有 "bili_jwt" token
    → 无 token: 显示登录页
    → 有 token: 调用 GET /api/auth/me 验证
      → 401: token 过期/无效 → 清除 token → 显示登录页
      → 200 role=unpaid: 显示"未解锁"锁定页
      → 200 role=paid/admin: 正常显示主界面
```

### 2.2 登录步骤

1. 加载 Google GSI SDK: `<script src="https://accounts.google.com/gsi/client" async defer></script>`
2. 调用 `GET /api/config/google-client-id` 获取 Google Client ID
3. 用获取到的 Client ID 初始化 GSI: `google.accounts.id.initialize({ client_id, callback })`
4. 用户点击 Google 登录按钮 → GSI 返回 credential
5. 调用 `POST /api/auth/login` 发送 credential → 返回 JWT token
6. 将 token 存入 localStorage (key: `bili_jwt`)，刷新页面

### 2.3 全局请求头

所有需要认证的 API 请求必须附加:

```
Authorization: Bearer <localStorage中的bili_jwt>
Content-Type: application/json
Cache-Control: no-cache
```

### 2.4 登出

清除 `bili_jwt` → 跳转登录页。

---

## 3. API 端点详细说明

### 3.1 GET /api/config/google-client-id

获取 Google OAuth Client ID。**无需认证。**

请求: 无参数

响应:
```json
{
  "client_id": "xxxxxxxxxxxx-xxxxxxxxxxxx.apps.googleusercontent.com"
}
```

---

### 3.2 POST /api/auth/login

Google 登录。**无需认证。**

请求体:
```json
{
  "credential": "google_oauth_credential_string"
}
```

响应:
```json
{
  "token": "eyJhbGciOiJIUzI1NiJ9..."
}
```

> 此 token 存到 localStorage，key 为 `bili_jwt`。

---

### 3.3 GET /api/auth/me

获取当前用户信息。**需要 JWT 认证。**

请求头: `Authorization: Bearer <token>`

响应 (paid/admin):
```json
{
  "email": "user@gmail.com",
  "role": "paid",
  "is_admin": false
}
```

响应 (unpaid):
```json
{
  "email": "user@gmail.com",
  "role": "unpaid",
  "is_admin": false
}
```

状态码:
- `401`: token 无效/过期 → 清除 token，显示登录页
- `403`: 未付费用户 → 显示锁定页

---

### 3.4 GET /api/dynamics

分页获取文章列表。**需要 paid+ 权限。**

查询参数:

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `limit` | int | 20 | 每页数量，最大 100 |
| `cursor` | string | "" | 分页游标（上一页返回的 `next_cursor`） |
| `type` | string | "" | 类型筛选（空=全部） |

响应:
```json
{
  "items": [
    {
      "dynamic_id": "123456789012345678",
      "date": "2025-06-01T12:00:00+08:00",
      "type": "DYNAMIC_TYPE_WORD",
      "title": "文章标题",
      "content": "文章内容 markdown 文本... ![img:0] ![img:1]",
      "tags": "标签1,标签2",
      "stocks": "股票1,股票2",
      "sectors": "板块1",
      "sentiment": "正面",
      "methods": "方法描述"
    }
  ],
  "has_more": true,
  "next_cursor": "123456789012345678"
}
```

> **首次加载**传空 cursor，后续加载用上次返回的 `next_cursor`。
> 图片占位符格式: `![img:N]` (N 为图片序号，0-based)。

---

### 3.5 GET /api/dynamics/:id

按 ID 获取单篇文章详情。**需要 paid+ 权限。**

路径参数: `dynamic_id` (B站动态 ID)

响应:
```json
{
  "dynamic_id": "123456789012345678",
  "date": "2025-06-01T12:00:00+08:00",
  "type": "DYNAMIC_TYPE_WORD",
  "title": "文章标题",
  "content": "文章内容 markdown 文本...",
  "stocks": "股票1",
  "sectors": "板块1",
  "sentiment": "正面",
  "methods": "方法描述",
  "analysis": "分析结果",
  "summary": "AI 摘要"
}
```

---

### 3.6 GET /api/search

组合搜索文章。**需要 paid+ 权限。**

查询参数:

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `keyword` | string | "" | 标题关键词搜索 |
| `date_from` | string | "" | 起始日期 (YYYY-MM-DD) |
| `date_to` | string | "" | 结束日期 (YYYY-MM-DD) |
| `limit` | int | 20 | 每页数量，最大 100 |
| `cursor` | string | "" | 分页游标 |

> 至少需要提供 `keyword` 或 `date_from`/`date_to` 其中之一。

响应:
```json
{
  "items": [
    { "dynamic_id": "...", "date": "...", "title": "...", "content": "...", ... }
  ],
  "has_more": false,
  "next_cursor": ""
}
```

---

### 3.7 POST /api/chat

AI 对话（SSE 流式）。**需要 paid+ 权限。**

> **这是整个系统最核心也最复杂的端点。** 返回 Server-Sent Events 流。

请求体:

```json
{
  "messages": [
    {
      "role": "system",
      "content": "你是清风研习社的 AI 助手，基于用户存档的 B站动态库回答。当前时间: 2025-06-01T12:00:00+08:00。工具调用轮数上限: 10"
    },
    {
      "role": "user",
      "content": "最近有什么关于 AI 的文章？"
    }
  ],
  "model": "deepseek-v4-flash",
  "effort": "high",
  "max_rounds": 10,
  "images": null,
  "debug": false
}
```

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `messages` | array | 必填 | 对话消息列表 |
| `model` | string | `""` | 模型: `deepseek-v4-flash` / `deepseek-v4-pro` |
| `effort` | string | `""` | 思考强度: `high` / `max` |
| `max_rounds` | int | 10 | 工具调用最大轮数 (1-50) |
| `images` | array\|null | null | Base64 编码的图片列表 |
| `debug` | bool | false | 是否输出调试信息 |

**model 可选值:** `deepseek-v4-flash` (默认), `deepseek-v4-pro`
**effort 可选值:** `high` (高思考), `max` (最强思考)

#### SSE 事件流格式

每行以 `data: ` 开头，JSON 格式。事件类型由字段区分:

**思考过程 (reasoning):**
```
data: {"reasoning": "模型正在思考的内容..."}
```

**回答增量 (delta):**
```
data: {"delta": "输出文本片段"}
```

**工具调用 (tool):**
```
data: {"tool": "search_title:AI 技术"}
```

**工具调用缓存命中 (cached):**
```
data: {"cached": "search_title:AI 技术"}
```

**工具调用结果 (articles):**
```
data: {"articles": [{"id": "1234567890", "date": "2025-06-01", "title": "...", "snippet": "...", "stocks": "", "sectors": "", "sentiment": "", "methods": ""}]}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 文章 dynamic_id |
| `date` | string | 日期 |
| `title` | string | 标题 |
| `snippet` | string | 内容片段 |
| `stocks` | string | 相关股票 |
| `sectors` | string | 相关板块 |
| `sentiment` | string | 情感分析 |
| `methods` | string | 分析方法 |

**对话结束 (done):**
```
data: {"done": true, "messages": [...]}
```
`messages` 包含本轮所有新增的 assistant/tool 消息。前端需要将这些消息追加到现有消息列表。

**调试信息 (debug):**
```
data: {"debug": {"round": 1, "request": {...}}}
data: {"debug_response": "响应内容预览"}
```

**缓存统计 (ds_usage):**
```
data: {"ds_usage": {"prompt_cache_hit_tokens": 1000, "prompt_cache_miss_tokens": 5000}}
```

#### SSE 流处理伪代码

```
let buffer = ""
let content = ""
let reasoning = ""
let finalMessages = []

while (stream not done):
    chunk = await reader.read()
    buffer += decode(chunk)
    lines = buffer.split("\n")
    buffer = lines.pop()  // 保留可能不完整的最后一行

    for (line of lines):
        if (!line.startsWith("data: ")) continue
        data = JSON.parse(line.slice(6))

        if (data.reasoning):
            // 累积思考内容，显示在消息气泡的"思考过程"折叠区域
            reasoning += data.reasoning
        elif (data.delta):
            // 累积回答文本，实时更新消息气泡
            // 如果有挂起的 reasoning，先 flush 到思考过程
            content += data.delta
        elif (data.tool || data.cached):
            // 显示工具调用卡片（侧边栏），展示搜索/检索行为
            // data.tool 格式: "函数名:参数"
        elif (data.articles):
            // 填充对应工具卡片的搜索结果
        elif (data.done):
            // 对话完成，将 data.messages 追加到消息列表
            // data.messages 格式: [{role, content, tool_calls, reasoning_content}]
        elif (data.debug):
            // 记录调试日志
        elif (data.debug_response):
            // 记录调试响应
        elif (data.ds_usage):
            // 更新缓存命中率展示
```

#### 系统提示词 (system prompt) 构造

```
你是清风研习社的 AI 助手，基于用户存档的 B站动态库回答。
当前时间: {当前 ISO 时间}
工具调用轮数上限: {max_rounds}

你的工具:
- search_query(query): 语义搜索（同时匹配标题和内容）
- search_title(keyword): 按标题关键词搜索
- search_tag(tag): 按标签搜索
- search_date(date): 按日期搜索
- read_article(id): 读取文章全文

回答要求:
- 引用信息时标注来源文章标题和日期
- 基于清风研习社 B站动态中的信息回答
- 不知道的不要编造
- 用中文回答
- 可以使用轮番思考
```

#### 消息格式

```typescript
interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: Array<{
    function: { name: string; arguments: string; };
  }>;
  reasoning_content?: string;
}
```

> **注意:** system prompt 由前端构造（不需要从后端获取），每次发送消息时带上完整历史。

---

### 3.8 GET /api/img/:key

获取图片。**无需认证。**

路径参数: `{dynamic_id}_{图片序号}`

示例: `/api/img/1234567890_0` (动态 1234567890 的第 0 张图片)

使用方式: 将文章内容中的 `![img:N]` 替换为 `<img src="/api/img/{dynamic_id}_{N}">`。

---

### 3.9 GET /api/stocks/active

获取活跃股票列表。**需要 paid+ 权限。**

响应:
```json
{
  "stocks": [
    {
      "order_book_id": "000001.XSHE",
      "symbol": "平安银行",
      "industry_name": "货币金融服务",
      "last_mentioned": "2026-06-01",
      "active_from": "2026-05-19",
      "active_mentions": 6,
      "mention_count": 9
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `order_book_id` | string | 股票代码 |
| `symbol` | string | 简称 |
| `industry_name` | string | 行业 |
| `last_mentioned` | string | 最近被文章提及日期 |
| `active_from` | string | 当前活跃窗口起始日期 |
| `active_mentions` | int | 活跃窗口内提及次数 |
| `mention_count` | int | 历史总提及次数 |

---

### 3.10 GET /api/stocks/prices/:order_book_id

获取股票分钟K线。**需要 paid+ 权限。**

查询参数:

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `start` | string | "" | 起始时间 YYYY-MM-DD-HH-MM |
| `end` | string | "" | 结束时间 YYYY-MM-DD-HH-MM |
| `limit` | int | 50 | 返回条数，最大200 |

响应:
```json
{
  "prices": [
    {
      "datetime": "2026-05-20-09-31",
      "open": 10.5,
      "high": 10.8,
      "low": 10.3,
      "close": 10.6,
      "volume": 1234567.0,
      "amount": 13000000.0
    }
  ]
}
```

---

### 3.11 股票页面（前端）

`#/stocks` 页面使用 [KLineChart](https://github.com/klinecharts/KLineChart) 渲染交互式K线图，库文件在 `js/klinecharts.umd.js`。

架构:
- `js/views/stocks.js` — 页面逻辑：获取活跃列表 → 用户点选股票 → 获取K线 → `klinecharts.init()` 渲染
- `css/stocks.css` — 全宽左右分栏布局（左侧320px股票列表，右侧图表区）
- 排序支持：活跃次数 / 总提及次数 / 最近提及日期

K线图交互能力：缩放、拖拽、十字光标、支持未来添加技术指标。

### 3.12 GET /api/admin/users

获取用户列表。**需要 admin 权限。**

响应:
```json
{
  "users": [
    { "email": "admin@gmail.com", "role": "admin", "created_at": "..." },
    { "email": "user@gmail.com", "role": "paid", "created_at": "..." }
  ]
}
```

---

### 3.10 GET /api/crawl

触发爬虫。**需要 admin 权限，60s 冷却。**

响应:
```json
{
  "status": 200,
  "body": "..."
}
```

触发后自动刷新页面。

---

### 3.11 GET /health

健康检查。**无需认证。**

响应:
```json
{ "ok": true }
```

---

## 4. 错误处理

API 统一的错误响应格式:

```json
{ "error": "错误描述信息" }
```

状态码约定:

| 状态码 | 含义 | 前端处理 |
|---|---|---|
| 401 | 未登录 / token 过期 | 清除 `bili_jwt`，跳转登录页 |
| 403 | 未付费 | 显示"需要付费权限"提示 |
| 404 | 资源不存在 | 显示"未找到" |
| 400 | 参数错误 | 显示错误信息 |
| 其他 4xx/5xx | 服务端错误 | 显示错误信息 |

---

## 5. 图片 URL 规则

文章 content 中的图片格式: `![img:N]`

完整 URL: `{API_BASE}/api/img/{dynamic_id}_{N}`

例如:
```
原内容: 这是一篇关于 AI 的文章 ![img:0] 然后 ![img:1]
渲染后: 
  <p>这是一篇关于 AI 的文章 <img src="https://qingfenapiflask-tanwdgitwa.cn-hangzhou.fcapp.run/api/img/1234567890_0"> 然后 <img src="https://qingfenapiflask-tanwdgitwa.cn-hangzhou.fcapp.run/api/img/1234567890_1"></p>
```

---

## 6. CORS

后端返回的 CORS 头:
- `Access-Control-Allow-Origin`: 配置的域名（默认 `https://suyuboy.github.io`）
- `Access-Control-Allow-Headers`: Authorization, Content-Type, Cache-Control
- `Access-Control-Allow-Methods`: GET, POST, OPTIONS, DELETE
- `Access-Control-Max-Age`: 86400

> 开发时如果前端不在允许的域名下运行，需要配代理或修改 CORS 配置。

---

## 7. 前端架构建议

### 路由

推荐 hash 路由（兼容 GitHub Pages 静态部署）:

| Hash | 页面 | 说明 |
|---|---|---|
| `#/dynamics` | 文章列表页 | 默认页 |
| `#/chat` | AI 对话页 | |
| `#/stocks` | 股票K线页 | 活跃股票列表 + 交互式K线图 |
| `#/login` | 登录页 | 未登录时显示 |

### 页面状态

每个页面需要处理:

| 状态 | 处理方式 |
|---|---|
| loading | 显示加载中提示或骨架屏 |
| empty | 显示"暂无数据" |
| error | 显示错误信息 + 重试按钮 |
| normal | 正常渲染数据 |

### localStorage key 清单

| Key | 用途 |
|---|---|
| `bili_jwt` | JWT token |
| `chat_sessions` | 对话历史列表 (JSON) |
| `chat_active_session` | 当前对话 session ID |
| `google_client_id` | Google Client ID 缓存 (sessionStorage) |

---

## 8. 路由与权限矩阵

| 路由 | 未登录 | unpaid | paid | admin |
|---|---|---|---|---|
| `#/dynamics` | 登录页 | 锁定页 | 文章列表 | 文章列表 |
| `#/chat` | 登录页 | 锁定页 | AI 对话 | AI 对话（额外调试功能） |
| `#/stocks` | 登录页 | 锁定页 | 股票K线 | 股票K线 |
| `#/login` | 登录页 | 登录页 | 自动跳走 | 自动跳走 |

> admin 用户可见"爬虫"按钮，可触发数据刷新。paid 用户隐藏该按钮。
> admin 用户在 chat 页面可见"调试"复选框和"查看调试"按钮。
