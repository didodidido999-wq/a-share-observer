# 安牛政策机会数据维护（schema_version 1）
只由研究更新任务维护 `docs/data/policy-opportunities.json`；本文件与原 `policy-funds.json` 分离，不更改原资金证据和其他页面。每次先读取最新 main 及当前 JSON，再更新；不能把历史候选池覆盖为本次新增名单。
- as_of 为最近实质更新日期，checked_at 为实际核验日期（北京时间 YYYY-MM-DD）；无变化可更新 checked_at，不伪造新事件。
- events 稳定 id；date=公开披露日；next_date=已明确的未来节点或 null；status: implemented/published/scheduled/consultation/watch/proposal/expired/cancelled。不得凭推测将日期、资金或政策标记为确定。source 为直接证据 HTTPS URL 或 null（仅预期）。
- themes 每条 id、rank、short、medium、policies（event ids）、logic、verify、risk。优先级为研究判断，不是收益预测。短期5—20交易日，中期1—6月。政策变动需重查传导与失效条件。
- stocks code 为保留前导零的6位字符串，全池一股一行；themes、horizons、drivers 为数组；priority='重点'或'观察'，core_rank 仅重点排序；state='active'或'archived'。保留 added_at、更新 updated_at、review。逐股 company_evidence 为日期、阶段、真实披露 URL；政策受益、贷款承诺、ETF持仓、实际增持互不等同。不得使用资金池标签推断新买入。
- 核查订单/中标、业绩、估值、量价、风险；缺失明确待核；失效候选归档而非删除，保留归档原因。变更写 change_log（date,summary）；如有新增政策/升级/降级/失效，通知用户。
- 更新前校验 events/themes ID 唯一、股票代码唯一、关联ID存在、合法日期/状态、来源可核查。不能写入或部署时，报告具体错误，保留原数据；不得假称已同步。

- 公司专属催化 events 可设置 stock_codes（六位字符串数组），避免把某一公司的回购事件套到同行；其余事件由主题关联。
