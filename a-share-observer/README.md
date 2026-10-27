# A股市场观察 · MarketScope

线上地址：https://www.aniu999.com/ ；网站由腾讯云 EdgeOne Makers 托管，代码及按天历史数据存储在 GitHub。

## 数据任务（2026-06-10 归档起点）

- **一次性回补：** GitHub Actions → `Update A-share dashboard` → `Run workflow` → `mode: backfill`。通过同花顺全市场10年未复权Parquet获取 **2026-06-10 至今** 的全市场每日统计；指数、行业及概念指数通过历史K线接口一次拉取相应区间；涨停股票池按交易日查询。旧数据若已经归档，尽可能复用，不覆盖已核实指标。
- **日常更新：** 北京时间 **每个工作日16:00** 自动触发 (`cron: 0 8 * * 1-5`)。先核实交易日历与当日全市场快照，再获取当日指数/板块快照与当天涨停池，保存新的历史日期。**正常日更不重新下载最近10日数据或10年数据包。**
- **缺失与补采：** 如果某天任务失败、或历史涨停池不可用，不能把无数据误计为0；可再运行 `mode: backfill` 进行回补，或者 `mode: rebuild` 离线重建日期索引/最新10日看板。二次回补如果历史原始市场统计已经完成就不会重新下载十年包。

## 数据文件

- `a-share-observer/docs/data/history/YYYY-MM-DD.json`：每日行情、指标、涨停股详情、板块数据（长期按日归档）。
- `a-share-observer/docs/data/dates.json`：所有已归档交易日期、存储占用、历史起点。
- `a-share-observer/docs/data/dashboard.json`：仅最近10个交易日的快速加载视图，不包含全部历史。
- 网页可以自由选择起止日期；首次打开默认最近10个交易日。选择历史区间时仅下载选中的日归档文件，并发请求数限制为6，板块矩阵每页60个板块。

历史板块涨停归因若缺乏**当时**成分股数据则留空；不能用最新成分股伪造2026年6月的历史归属。历史特色数据能否回补取决于同花顺实际接口返回。

## GitHub Actions / EdgeOne

GitHub仓库当前布局多出一级 `a-share-observer/`，因此 EdgeOne Makers 的项目 **根目录设为 `a-share-observer`、构建命令 `npm run build`、输出目录 `docs`**。其它步骤和以前相同；ECharts构建时被复制到站内，不需要浏览器跨境获取外部CDN资源。

- GitHub Repository Secret: `HITHINK_FINANCE_API_KEY`。绝不公开密钥或预签名下载链接。
- 任务使用Ubuntu 24.04 + Python 3.11，120分钟回补超时保护，Git推送遇到分支更新自动fetch/rebase最多3次，**不使用强制推送**。
- 归档工作区历史数据软阈值400MiB；超过后尝试移除最旧文件、保留最近10个交易日。但**Git已提交过的旧blob并不会因此从Git对象历史立即释放**，未来应提前迁移至对象存储或单独归档仓库，不应将软阈值当成GitHub官方免费存储配额。当前日文件约110KB，距离软阈值很远。
- 公共网站展示行情前，请确认同花顺授权允许公开展示/再分发。

## 本地检查

```bash
python -m pip install -r a-share-observer/requirements.txt
python -m pytest -q a-share-observer/tests
python a-share-observer/scripts/history.py --mode rebuild
```

`backfill` / `auto` 需要有效同花顺API Key，离线检查不能验证账号额度或历史特色数据覆盖率。
