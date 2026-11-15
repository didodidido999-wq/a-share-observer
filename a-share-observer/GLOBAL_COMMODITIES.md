# 真实原油现货基准

脚本 `scripts/global_commodities.py` 不依赖API密钥，优先读取EIA官方XLS原始文件，失败时才尝试FRED公开CSV同源分发。XLS严格核对品种Sourcekey、完整标题和美元/桶单位。EIA原始页面当前发布日期为可选元数据，访问失败时保持null，不阻断已核验价格。

- WTI库欣现货：`DCOILWTICO`，美元/桶。EIA原页 https://www.eia.gov/dnav/pet/hist/RWTCD.htm ，FRED说明 https://fred.stlouisfed.org/series/DCOILWTICO 。
- Brent欧洲现货：`DCOILBRENTEU`，美元/桶。EIA原页 https://www.eia.gov/dnav/pet/hist/RBRTEd.htm ，FRED说明 https://fred.stlouisfed.org/series/DCOILBRENTEU 。
- 复用依据：EIA https://www.eia.gov/about/copyrights_reuse.php ，FRED油价序列标记Public Domain / Citation Requested。此判断不扩展至FRED其他版权序列。

本次2026-11-15真实核验：CSV与EIA官方XLS均末至2026-11-11，WTI 89.62、Brent 92.14美元/桶。EIA页面发布日为11/12、下次发布11/18。CSV并非实时数据；这两者都是现货，不是期货、连续合约或油气股票ETF。Brent与WTI品质、地点不同，价差不能直接理解成套利收益。

`date` 仅为源观察日期。当前 `source_release_date` 不能回填成每个历史点公布时间。源无交易所收盘时区，`market_timezone=null`；`publication_timezone=America/New_York`仅作发布地区说明。保守跨境视图只用中国查询日前的观察日期，但这仍不证明当时已公布，因此不用于严格无前视回测。

从2026-06-10起保留有值观察；空值不插值、不填零，失败不覆盖既有序列。状态单独保存于 `docs/data/global/commodities-status.json`。全部失败返回非零；部分成功状态partial，逐资产展示失败。route与warnings明确区分eia_xls、fred_csv、release_html失败阶段。不要将脚本运行时间称为行情日期。

```sh
python scripts/global_commodities.py
python -m pytest tests/test_global_commodities.py
```

未自动接入：S&P500与Nasdaq虽有可读取FRED CSV，但公开再分发许可未解决；LBMA黄金旧FRED序列已移除。KOSPI/SOX/HK等未获得口径和复用条件均清晰的可用源。它们保留缺口，绝不把ETF价格改标签冒充指数或商品。

定时任务：`global-benchmarks.yml` 每天北京时间09:40尝试更新，源可能多日不发布。采集全失败仍提交独立失败状态并保留旧价格，最后将任务标记失败供监控发现；部分失败逐资产标记，不显示伪实时价格。

稳定性修复：GitHub首次FRED访问超时后，已改为官方XLS优先，新增xlrd解析。只有实际GitHub工作流成功才可称该路径在CI可用；本地成功不代表每日自动运行已稳定。
