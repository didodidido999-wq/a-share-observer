# A股市场观察 · MarketScope

线上地址：https://www.aniu999.com/ ；网站由腾讯云 EdgeOne Makers 托管，代码及按天历史数据存储在 GitHub。

## 数据任务（2026-06-10 归档起点）

- **一次性回补：** GitHub Actions → `Update A-share dashboard` → `Run workflow` → `mode: backfill`。通过同花顺全市场10年未复权Parquet获取 **2026-06-10 至今** 的全市场每日统计；指数、行业及概念指数通过历史K线接口一次拉取相应区间；涨停股票池按交易日查询。旧数据若已经归档，尽可能复用，不覆盖已核实指标。
- **日常更新：** 主采集计划北京时间工作日 16:07、16:49，代表股 16:18，板块 16:34、17:09，恢复任务 17:26、18:16。调度可能延迟，程序使用交易日历选择最近已收盘交易日（16:00 后）；周末、节假日和次日凌晨不再按“今天还没收盘”空跑成功。
- **缺失与补采：** 当日仅取日期匹配的收盘快照；跨日只用带日期的历史日线，不把现有快照冒充历史。近九个已收盘交易日内的缺档使用滚动 10 日包、历史指数/板块 K 线和按日期涨停池定向补录。常规已完整归档日期复用，不重复下载；超出窗口应人工评估完整历史回补。
- **完成判据：** 恢复验证目标日期的基础归档、代表股当日覆盖以及板块成员衍生质量；跳过或沿用旧日期不等于恢复成功。历史特色字段不能可靠还原时保持缺失，质量状态不会伪装为完整。
- **离线重建：** `mode: rebuild` 仅从已有归档重建索引和看板，不能生成缺失交易日。


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
