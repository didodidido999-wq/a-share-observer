# 政策、宏观与事件核验台账

## 已交付范围

`docs/data/policy-context.json` 保存人工核验的 4 条记录和 5 项国家统计局未来日程，核验日 2026-11-15：

- 三季度 GDP 初步核算及消费、投资分项，直接读取国家统计局 2026-10-19 10:00 原文。
- 10 月 CPI / 核心 CPI / PPI，直接读取国家统计局 11 月 9 日统计解读原文，确认 PPI 环比为 **+0.7%**，不是 -0.7%。原页面仅列成文日期，故保留真实发布日期11月9日、公开时刻为null，另设保守可用界限为次日 00:00，不杜撰 09:30。
- 价格传导的官方解释单独标为“官方解读”，不是正式政策或媒体社论。
- 11 月 16 日经济运行、24 日生产资料旬价、27 日工业利润、30 日 PMI、12 月 9 日 CPI/PPI，来自国家统计局 2025-12-25 09:30 发布的 2026 日程表；全部是可调整的初步计划，没有填入未公布结果或虚构一致预期。

新增发改委11月12日成品油调价正式信息（每吨汽油-645、柴油-625元，11月12日24时生效）。没有完整总量政策文件、人民日报社论、新华社评论及国际经济数据库。界面明确显示这些缺口，日期未定观察项只是研究计划。

## 时间与使用边界

当前资料模式按现在核验可用时间展示，不跟随行情选日；严格历史模式按选日北京时间 14:45 过滤。必须同时满足公开时间和系统实际留存时间 <= 截止点，故 11 月 15 日新建台账不能倒填 11 月 13 日历史策略。报告期和可用日期分开。所有研究推论独立标示，不转成买卖建议。

每条记录有稳定 ID、版本、supersedes、源链接、报告期、真实公开日期及精度、独立保守边界、实际留存时间、available_at。文件内无已有历史预测，不能用它给历史策略计准确率。修订应追加新 ID 并指向旧 ID，不修改原文；界面按截止点选择当时有效版本。

## 更新与验收

```sh
python scripts/policy_context.py
python scripts/policy_context.py --append /path/to/verified-new-records.json
node --test tests/policy-context.test.mjs
python -m unittest discover -s tests -p test_policy_context.py
```

补录先核对官方原文及许可，保留具体 source_url。确认单位、同比/环比、单月/累计、初步/修订、发布时间后才追加。自动校验只能阻止格式和倒填错误，不代表内容事实已经自动核验。当前没有自动采集或调度；须由网站统一维护任务另行接入，不能声称该模块会自行每日更新。

UI 契约：`MarketScopePolicy.render({state})`，宿主 `#policy-content`。记录 ID 是 DOM anchor；例如 `#policy?anchor=nbs-202610-prices-v1`。`policy-calendar` 和 `policy-macro` 是分区定位。资料只用 DOM textContent 安全输出。

## 每日维护流程（人工核验，不是已启用的采集器）

1. 打开国家统计局日程及具体新发布原文，核对已过期计划是否延期、是否实际发布；同时核对财政部、央行、发改委等主管部门的正式文件，人民日报/新华社文章按实际栏目分类。
2. 准备增量 JSON：`{"checked_at":"实际核验时刻，带时区","records":[],"events":[]}`。`checked_at` 只能在真实完成检查后刷新，不能仅因脚本成功而更新。没有新条目时仍须记录核查工作及缺口，不声称资料全面。
3. 每条新记录使用新 ID，保存原文精确 URL、版本、报告期、摘要、研究推论和限制。公开只有日期时使用 `published_date`、`published_at: null`、`published_precision: "date"`，并另设 `availability_boundary` 为北京时间次日零时。它是保守边界，不是来源的真实发布时间。`available_at` 不早于保守边界和实际留存时间二者较晚者。
4. 旧数据修正、事件延期、实际结果更新都必须追加新 ID / 更高 revision，并设置 `supersedes` 指向上一版本；旧条目不得修改或删除。事件结果另有 `result_published_at`，未取得结果保持 null。日程的 announced_at 保留原年度表实际发布时刻 2025-12-25 09:30，不以核查日期替代；真正变更通知应采用其本身的公布时间和来源。
5. 执行 `python scripts/policy_context.py --append NEW.json`，再执行 `python scripts/policy_context.py --git-base BASE_COMMIT`。CI 的 BASE_COMMIT 应取 pull request 的 base SHA；必须已 fetch 该提交。不存在的 ref 或 Git 读取失败会报错，不会略过检查。只有已验证 base commit 中从未存在该文件时允许首次建档。
6. 跑单元及浏览器测试；核对源链接、实际公开日期、生效时间、历史14:45隔离、7/30天日历后按已授权发布流程处理。

页面在最后核验距现在超过48小时或时间无效时明确告警，保留旧数据但不假装当前。未来日历和任何新条目仍不能倒填系统建档之前的策略样本。
