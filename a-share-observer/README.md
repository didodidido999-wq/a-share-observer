# A股市场观察 · MarketScope

A股市场指数、行业/概念板块、涨停和炒作风格自动看板。网站默认最近 **10 个A股交易日**；历史聚合数据按日期保留。

## 部署架构（方案A）

- GitHub Actions：工作日北京时间 **17:30** 执行 `scripts/update.py`，使用 GitHub Actions Secret 中的 `HITHINK_FINANCE_API_KEY` 请求同花顺 hithink-finance。
- GitHub：保存代码及 `docs/data/dashboard.json`、`docs/data/history/` 数据更新提交。
- 腾讯云 EdgeOne Pages：以 Git 仓库导入方式连接 `main` 分支；GitHub 每次推送后自动重新部署网站。
- 网站前端位于 `docs/`；EdgeOne 构建阶段 `npm run build` 将 ECharts 复制为同站点资源，浏览器不再依赖 jsDelivr CDN。

**状态**：仓库代码即使已部署成功，首次行情采集成功前仍显示“尚未接入真实数据”。本项目不会发布模拟行情代替真实数据。

## 首次操作

1. 在 [GitHub](https://github.com/didodidido999-wq/a-share-observer) 的 `main` 分支上传此压缩包里**解压后的全部文件**，注意文件必须位于仓库根目录，包括 `.github/workflows/update.yml`（不能把 ZIP 原封不动上传）。用 GitHub Desktop `Clone` 空仓库，复制文件，`Commit` 后 `Push` 最稳妥。
2. 检查 `Settings → Secrets and variables → Actions → Repository secrets` 下已有 `HITHINK_FINANCE_API_KEY`，不用公开其值。此前在聊天里泄露的旧Key应撤销并替换。
3. 在 GitHub `Settings → Actions → General → Workflow permissions` 允许工作流具备 `Read and write permissions`，以便自动提交历史数据。
4. 打开 [EdgeOne Makers](https://pages.edgeone.ai/)，创建项目选择 **导入 Git 仓库** → 授权 GitHub → `didodidido999-wq/a-share-observer` → `main`。
5. 项目设置（也由根目录 `edgeone.json` 预设）：**根目录 `./`；安装命令 `npm install`；构建命令 `npm run build`；输出目录 `./docs`；Node 22**。区域选择 **全球可用区（不含中国大陆）**（免ICP备案；但不保证大陆访问质量）。
6. 构建成功后 EdgeOne 会提供项目访问地址；要在大陆正常长期通过域名访问，强烈建议添加**自有域名**。`项目 → 域名管理 → 添加自定义域名`，根据界面完成TXT验证和CNAME解析（未备案请选择非中国大陆加速区域）。
7. GitHub `Actions → Update A-share dashboard → Run workflow` 手动执行一次，检查日志中的API权限、数据覆盖和提交。Push 新JSON后，EdgeOne应自动重建发布。

## 质量与安全

- Python 程序只通过后端环境变量读取API Key；`docs/`不包含Key。
- API故障保留已发布数据，不将不可用值伪装成零。
- 全部板块及风格因API授权/配额可能不完整，网站会清楚展示缺失。
- GitHub公开仓库发布的聚合数据也属于公开展示，**需要核实同花顺的数据使用/再分发许可**。
- 17:30是定时触发时间，不是保证网站17:30完成更新；Actions可能排队/失败，可手动重跑。
- 若需要在大陆境内节点提供服务，域名必须依法先办ICP备案。

## 本地检查

```bash
pip install -r requirements.txt
pytest -q
npm install
npm run build
python -m http.server 8000 --directory docs
```

## 目录

- `docs/`：所有页面和公开衍生数据；`docs/vendor/echarts.min.js`为构建自动生成。
- `scripts/update.py`：请求官方REST、生成最近10日看板数据及历史聚合。
- `.github/workflows/update.yml`：定时API采集、测试、数据提交（**不再部署GitHub Pages**）。
- `edgeone.json`：EdgeOne项目构建输出配置。
