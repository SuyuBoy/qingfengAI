# 前端模块手册

## 数据表（8 张）

### 1. bili_dynamics — B站动态
| PK | Type |
|----|------|
| dynamic_id | STRING |

列: date, type, title, content, embedding

每篇爬取的 B 站动态文章。写入后不改。

### 2. bili_images — 动态配图
| PK | Type |
|----|------|
| dynamic_id | STRING |

列: img_0, img_1, ... (分块存储，每块 ≤2MB)

### 3. bili_config — 键值配置
| PK | Type |
|----|------|
| uid | STRING |
| dynamic_id | STRING |

uid 固定为 "config"，dynamic_id 为 key。存 B 站 cookie 等。

### 4. bili_users — 用户
| PK | Type |
|----|------|
| uid | STRING |
| email | STRING |

uid 固定为 "config"。role: unpaid/paid/admin。

### 5. article_analysis — LLM 分析结果
| PK | Type |
|----|------|
| dynamic_id | STRING |

列: date, stocks, sectors, market_sent, methods, stocks_detail

DeepSeek 提取的结构化信息。stocks_detail = JSON: `[{o, n, sc, r}]`（代码，名称，评分，理由）。

### 6. index_state — 指数快照
| PK | Type |
|----|------|
| period | STRING |
| period_date | STRING |

period: "1d" / "1w" / "1m"
列: open_val, high, low, close, volume, base_value, latest_value, holdings, params, articles_used, summary

holdings = JSON: `[{o, symbol, sc, w, open, high, low, close, volume}]`
- 调仓时写入 o/sc/w
- 收盘后补 OHLCV + name

### 7. stock_pool — 股票池
| PK | Type |
|----|------|
| order_book_id | STRING |

列: symbol, sector_code, industry_name, listed_date, special_type, added_date, last_mentioned, mention_count, active_from, active_mentions, active

活跃条件: 30天内有提及。updateRow 增量更新，不丢元数据。

### 8. stock_prices_day — 个股日K线
| PK | Type |
|----|------|
| order_book_id | STRING |
| date | STRING |

列: open, high, low, close, volume

活跃股票自动下载。新激活补 50 天历史，已有股票每日增量。


---

## 部署流程

### GitHub Actions 自动构建

`.github/workflows/react-root.yml`，推送 `frontend/**` 源码后自动 npm build + commit 产物。

**不要手动提交构建产物（index.html、assets/）**。

### Git 推送

```bash
# HTTPS 不稳定时用
GIT_SSL_NO_VERIFY=1 git push origin main
```

## 前端文件结构

```
index.html             # 构建产物入口
assets/                # 构建产物
frontend/
  src/
    pages/
      StocksPage.tsx        # 股票页壳（~100行）
      stocks/
        StockPanel.tsx      # 右侧侧边栏 + 指数卡片
        IndexCard.tsx       # 指数卡片 + 持仓弹窗
        ChartContainer.tsx  # K线容器
        stockUtils.ts       # 工具函数
      ChatPage.tsx          # AI 对话
      DynamicsPage.tsx      # 动态文章
      LoginPage.tsx         # 登录
    components/ui/
      calendar.tsx          # react-day-picker 日历控件
```

## 爬虫定时流程

| 时间 | 动作 |
|------|------|
| 每小时 | crawl B站 |
| 周一 0:50-1:10 | 周总结 |
| 9:10-9:30 | 调仓（幂等） |
| 9:30-15:10 | 分钟线（每次更新后同步日线） |
| 18:00 | 股票池更新 + K线下载 |
