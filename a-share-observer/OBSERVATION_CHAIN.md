# 科技观察链

放在现有宏观页上方，不增加导航、不改变现有板块追踪或查询。

## 已实现
- 三星电子（KRX 005930普通股）、SK海力士（000660）Google Finance 具体行情入口（公司官方页仅用作代码核验）。
- SOX 官方历史查询深链及本站原指标独立入口，清楚标明未接入的点位、日涨跌幅、历史和区间涨跌。
- 七姐妹各自单股行情入口，Alphabet仅列GOOGL，不人为构造综合指数。
- 已归档 A 股半导体、存储芯片、半导体设备、东数西算板块所选日涨跌幅。缺失留空、不沿用邻日。此关联板块选择是观察用途，不构成因果或领先性断言。
- 移动端单列，桌面四列；口径说明默认折叠。无港股新增项、无ETF替代原指数。

## 未完成的数据接入
海外节点只有查询入口，没有本站可发布历史行情，不应对用户宣称数据已补齐。没有新增爬取器、定时采集、实时价格或100天回补。既有A股归档沿用原网站数据，不扩展供应商授权范围。

2026-11-17 核验：
- https://www.samsung.com/global/ir/stock-information/listing-Info/ 确认普通股005930。
- https://www.skhynix.com/ir/UI-FR-IR01/ 确认000660。
- https://www.schwab.com/learn/story/what-are-magnificent-7-stocks 确认七家公司，Alphabet有GOOGL/GOOG类别，本站仅选GOOGL。
- https://indexes.nasdaq.com/Index/History/SOX 官方历史页，可跳转查看；可浏览不等于可复制历史公开展示。
- https://fred.stlouisfed.org/series/NASDAQSOX 来源Nasdaq，明确Copyrighted: Pre-Approval Required。因此未复制序列到公开站点。

日后获准公开的接入应同时提供来源、实际交易日、时区、公布/采集时间、许可依据和覆盖范围，并按中国所选日截断可用记录。不得用同日美国收盘造成前视。

2026-11-17 QA修正：三星与SK海力士入口改为Google Finance的005930:KRX与000660:KRX；GOOGL改为Google Finance的GOOGL:NASDAQ。三条深链均已读取，确认有对应证券、价格及日期。未复制其行情。正文补充“观察顺序，非领先保证｜各市场日期不同”。
