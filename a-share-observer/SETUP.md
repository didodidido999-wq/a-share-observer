# 本次升级说明（2026-06-10 起）

## 上传至已有 GitHub 仓库

目标仓库 `didodidido999-wq/a-share-observer`，保持原有两层布局：

1. `.github/workflows/update.yml` （替换现有文件）
2. `a-share-observer/scripts/history.py` （新增）
3. `a-share-observer/docs/app.js` （替换）
4. `a-share-observer/docs/index.html` （替换）
5. `a-share-observer/docs/styles.css` （替换）
6. `a-share-observer/tests/test_history.py` （新增）
7. `a-share-observer/README.md` 和 `SETUP.md` （更新）

**不要删除已有的** `scripts/update.py`、旧的 `history/*.json`、`dashboard.json` 或 `package.json`。`history.py` 复用 `update.py` 中经过测试的API调用与计算逻辑。

## 首次回补

1. 打开 GitHub → Actions → `Update A-share dashboard` → `Run workflow`。
2. 选 `mode: backfill`，执行一次性历史采集。这次会下载全量Parquet、回查板块和涨停数据；时间明显长于日常更新。
3. 任务变绿以后，查看 `a-share-observer/docs/data/dates.json` 的 `configured_start`, `earliest`, `latest`, `archive_days`。如果某些历史接口无数据，工作流日志会提示缺失而不造假。
4. EdgeOne若已绑定GitHub，代码和数据推送后应自动部署；如前台仍显示旧值，检查EdgeOne最新部署记录及缓存。
5. 后续默认 `mode: auto`，每天16:00只抓新的交易日。当日已归档会跳过API采集。

## 说明

GitHub接口给当前ChatGPT连接返回了403写入权限错误，因此这份压缩包是可直接上传的代码更新，**并不意味着已提交到线上GitHub仓库**。
