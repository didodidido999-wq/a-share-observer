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

2026-11-15 GitHub运行器复测：官方XLS主路径两项均成功，状态observed且warnings为空，最新源观测仍为11/11。未来定时运行仍以每次状态为准，不承诺上游永不失败。

## 2026-11-16 查询入口精简（待发布代码）

当前查询及常规 `global_direct.py` 采集移除四项早期替代：`korea_chip_mixed`（中韩芯片不能代表KOSPI/SOX）、`us_nasdaq_tech`（不是SOX且与纳指100代理重叠）、`china_oil_gas_equities` / `us_oil_gas_equities`（企业股票不是油价）。旧JSON、一次性探测结果及原研究记录不删除、不改值；旧查询链接给出退役解释，不自动替换为另一资产。一次性历史探测工具保留，不列入日常采集。

油价观察使用已接入的EIA WTI/Brent现货；国内SC连续序列单列。这是不同标的的查询替换，不拼接旧ETF历史，也不将现货改称期货。SOX/KOSPI原指数仍无合适的线上原序列，保留缺口。妙想标普/恒生小范围接口测试不等于已发布，公开展示权限尚未确认。

纳指100、标普500、恒生、恒生科技、日经225、DAX、黄金这七项境内ETF代理仍单列并明确标注，目前未见已上线、口径和展示权限均验证过的原序列足以取代。它们的价格不是海外指数原值或国际黄金现货。

## 2026-11-16 历史覆盖回补（本地验证，未发布）

以既有归档起点2026-06-10为准，而不是用前值或零值拼满100天。中国国债2年/10年、Shibor隔夜/1周原各28个观测日（10/08–11/13），从原有东财带日期报表补为各109个观测日（6/10–11/16）；每条新增81行，原28行逐值一致。`backfill_macro.py` 同步轻量宏观档与风险索引的宏观部分，任何历史冲突或单位变化拒绝写入；其余股票内容不变。日常宏观获取起点同步改到6/10，分页有界且核对源行数，避免新环境只采45日。

其余已用序列无需重复回补：7只保留ETF和SC各106日，美债及期限利差各107日（末11/12），WTI108日/Brent110日（末11/11）。各市场休市和披露日期不同，行数不强行对齐；不证明每个历史日期当时可知。12项未获可发布原序列的指标仍缺口，4类资金披露按真实公告或报告期，不造每日持仓。界面默认窗口与实际历史覆盖不同，应选择“全部历史”查看。
