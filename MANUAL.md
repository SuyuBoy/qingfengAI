# 前端模块手册

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
    pages/
      StocksPage.tsx        # 股票页壳
      stocks/
        StockPanel.tsx      # 右侧侧边栏 + 指数卡片
        IndexCard.tsx       # 持仓弹窗（表格：名称/代码/开/收/涨跌/权重）
        ChartContainer.tsx  # K线容器
        stockUtils.ts       # 等权聚合、颜色交换等
      ChatPage.tsx          # AI 对话
      DynamicsPage.tsx      # 动态文章
      LoginPage.tsx         # 登录
    components/ui/
      calendar.tsx          # react-day-picker 日历
```

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
