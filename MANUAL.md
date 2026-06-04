# 清风研习社 系统手册

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

列: img_0, img_1, ... （分块存储）

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

uid 固定为 "config"。role: unpaid / paid / admin。

### 5. article_analysis — LLM 分析结果
| PK | Type |
|----|------|
| dynamic_id | STRING |

列: date, stocks, sectors, market_sent, methods, stocks_detail

DeepSeek 提取。stocks_detail = `[{o, n, sc, r}]`（代码、名称、评分、理由）。写入前经 normalize.py 正规化，错码自动修正（含 XSHE↔XSHG 交换）。

### 6. index_state — 指数快照
| PK | Type |
|----|------|
| period | STRING |
| period_date | STRING |

period: "1d" / "1w" / "1m"

列: open_val, high, low, close, volume, base_value, latest_value, holdings, params, articles_used, summary

日线 OHLCV 从分钟线聚合（O=首分钟开，C=末分钟收，H/L=真实极值）。

holdings = `[{o, symbol, sc, w, open, high, low, close, volume}]`
- 调仓时写入 o/symbol/sc/w，引擎自动补名称
- OHLCV 收盘后补（有分钟线时从分钟聚合，否则从 stock_prices_day 查）

### 7. stock_pool — 股票池
| PK | Type |
|----|------|
| order_book_id | STRING |

列: symbol, sector_code, industry_name, listed_date, special_type, added_date, last_mentioned, mention_count, active_from, active_mentions, active

- **入池时机**：爬虫打分时立刻注册（StockPoolTable.upsert），不等 18:00
- **活跃条件**：30 天内有提及。不活跃仍保留记录，K 线删除
- **updateRow** 增量更新，不丢 symbol/industry_name 等元数据

### 8. stock_prices_day — 个股日K线
| PK | Type |
|----|------|
| order_book_id | STRING |
| date | STRING |

列: open, high, low, close, volume

- **下载时机**：新股票被爬虫提及时立刻下载近 50 天；存量活跃股票每日 18:00 增量当日
- **数据源**：rqdatac

---

## 关键算法

### 指数日线 OHLCV

**有分钟线时**（盘中）：等权聚合 rqdatac 实时分钟线 → 每日 O=首分钟开，C=末分钟收，H/L=真实极值，V=加权和。

**无分钟线时**（历史）：C = C_yesterday × avg(今日收盘/今日开盘)。开盘永远等于昨日收盘。H/L 同理。

### 正规化（normalize.py）

AI 只输出股票名称 `n`，normalize.py 匹配到 order_book_id `o`：
1. 已是合法 code → 直接返回
2. 精确名称匹配 rqdata_stocks
3. 去 ST 前缀/括号后匹配
4. 补 ST 前缀再试
5. 子串匹配（≥3 字唯一）
6. 首 2 字 + 70% 字符重叠匹配
7. 去后缀（股份/科技/A/B 等）
8. 交换 XSHE↔XSHG 后缀（修正 DeepSeek 错码）
9. 全部失败 → 丢弃

---

## 部署

### GitHub Actions

`.github/workflows/react-root.yml` — 推送 `frontend/**` 后自动 npm build + commit 构建产物。**不要手动提交 index.html / assets/**。

### FC 部署

```bash
bash scripts/deploy.sh crawler   # 爬虫
bash scripts/deploy.sh api       # API
```

### Git 推送（HTTPS 不稳定时）

```bash
GIT_SSL_NO_VERIFY=1 git push origin main
```

---

## 前端文件结构

```
index.html             # 构建产物入口
assets/                # 构建产物
frontend/src/
  pages/
    StocksPage.tsx        # 股票页壳
    stocks/
      StockPanel.tsx      # 右侧侧边栏 + 指数卡片
      IndexCard.tsx       # 持仓弹窗（名称/开/收/涨跌/权重）
      ChartContainer.tsx  # K线容器
      stockUtils.ts       # 工具函数
    ChatPage.tsx          # AI 对话
    DynamicsPage.tsx      # 动态文章
    LoginPage.tsx         # 登录
  components/ui/
    calendar.tsx          # react-day-picker 日历控件
```

---

## 爬虫定时流程

| 时间 | 动作 | 说明 |
|------|------|------|
| 每小时 | crawl B站 | 爬取→DeepSeek 打分→normalize→入池→下载 K 线 |
| 周一 0:50-1:10 | 周总结 | 7 天文章→DeepSeek(pro,256k)→1w 持仓+指南 |
| 9:15-9:25 | 日调仓 | AI 合并打分→引擎衰减累加→Top15 等权持仓（幂等） |
| 9:30-15:10 | 分钟线 | rqdatac 合并请求→等权聚合 1m bars→每次同步日线 |
| 18:00 | 池子维护 | updateRow 更新激活状态 + 30 天未提及移出不活跃并删 K 线 + 存量当日 K 线 |
