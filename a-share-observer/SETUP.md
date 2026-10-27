# EdgeOne Pages 快速上线

1. 解压项目，将内部全部文件放进 GitHub `didodidido999-wq/a-share-observer` 仓库 **根目录** 并推送 main。
2. 登录 https://pages.edgeone.ai/ → 创建项目 → **导入Git仓库** → 选择上述仓库。
3. 保持：根目录 `./`；构建 `npm run build`；输出 `./docs`；Node 22；安装 `npm install`。
4. 区域选 **全球可用区（不含中国大陆）**，免ICP备案。构建完成后获取地址。
5. GitHub 仓库 Actions → Update A-share dashboard → Run workflow 检查真实数据。已保存的 `HITHINK_FINANCE_API_KEY` 不要贴到网页或代码。
6. EdgeOne → 域名管理 → 添加自定义域名，按照界面操作 DNS 验证及CNAME。选择大陆节点前先完成ICP备案。

如 GitHub Actions 推送数据被拒绝，打开仓库 Settings → Actions → General → Workflow permissions，赋予 Read and write permissions。
注意：GitHub Actions 每次更新数据并推送到main后，EdgeOne从GitHub自动重新部署，无需额外 EdgeOne API token。
