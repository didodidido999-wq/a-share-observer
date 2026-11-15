# 真实原油现货基准

脚本 `scripts/global_commodities.py` 不依赖API密钥，使用FRED公开CSV分发的美国EIA数据，并核对EIA原始页面的当前发布日期。

- WTI库欣现货：`DCOILWTICO`，美元/桶。EIA原页 https://www.eia.gov/dnav/pet/hist/RWTCD.htm ，FRED说明 https://fred.stlouisfed.org/series/DCOILWTICO 。
- Brent欧洲现货：`DCOILBRENTEU`，美元/桶。EIA原页 https://www.eia.gov/dnav/pet/hist/RBRTEd.htm ，FRED说明 https://fred.stlouisfed.org/series/DCOILBRENTEU 。
- 复用依据：EIA https://www.eia.gov/about/copyrights_reuse.php ，FRED油价序列标记Public Domain / Citation Requested。此判断不扩展至FRED其他版权序列。

本次2026-11-15真实核验：CSV与EIA官方XLS均末至2026-11-11，WTI 89.62、Brent 92.14美元/桶。EIA页面发布日为11/12、下次发布11/18。CSV并非实时数据；这两者都是现货，不是期货、连续合约或油气股票ETF。Brent与WTI品质、地点不同，价差不能直接理解成套利收益。

`date` 仅为源观察日期。当前 `source_release_date` 不能回填成每个历史点公布时间。源无交易所收盘时区，`market_timezone=null`；`publication_timezone=America/New_York`仅作发布地区说明。保守跨境视图只用中国查询日前的观察日期，但这仍不证明当时已公布，因此不用于严格无前视回测。

从2026-06-10起保留有值观察；空值不插值、不填零，失败不覆盖既有序列。状态单独保存于 `docs/data/global/commodities-status.json`。全部失败返回非零；部分成功状态partial，逐资产展示失败。不要将脚本运行时间称为行情日期。

```sh
python scripts/global_commodities.py
python -m pytest tests/test_global_commodities.py
```

未自动接入：S&P500与Nasdaq虽有可读取FRED CSV，但公开再分发许可未解决；LBMA黄金旧FRED序列已移除。KOSPI/SOX/HK等未获得口径和复用条件均清晰的可用源。它们保留缺口，绝不把ETF价格改标签冒充指数或商品。
