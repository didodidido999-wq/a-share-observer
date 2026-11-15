# 每日公开证据补充流程

`docs/data/reviewed-evidence.json` 是公开资料核验的追加式事实源，初始 records 为空。catalog 只是待核验任务，不是数据或零值。自动采集器只读此源，不覆盖其内容。不得将搜索摘要、猜测、查无结果作为“已排除风险”。

1. 先查看 catalog、现有 records 和自动源失败/缺口。只查与明确缺口相关的公开网页，优先交易所、发行人、监管部门。读取原文核对对象、单位、统计口径、数据日与实际公布时间。
2. 准备单个 JSON 对象或数组，包含 id（唯一）、revision、supersedes、code（六位代码.SH/.SZ/.BJ）或 asset_id（二选一）、kind、metric_id、value、unit、data_date、published_at、observed_at、source_url、source_title、note、status。不要将测试文件示例发布为真实记录。
3. kind=metric 时 status=verified、value 必须有限数字、unit 必填；kind=event 时 value=null，事实写 note。找不到、尚未公开或不确定时使用 kind=gap，status=unknown 或 not_found，value=null，说明查询范围和原因。零只用于原文明示的真实零值。
4. 时间戳必须有 Z 或时区偏移。observed_at 为实际核验时间；published_at 仅填原文明确的公布时间，不知则 null，禁止拿抓取时间冒充。data_date 为已发生事实日期；未来已公告安排放 note，并清楚写“计划/预计”，不作为未来已发生观察值。没有公布时间的记录不得用于历史已知结论。
5. source_url 只用可公开访问的 HTTPS 原文，不用登录页、私有资料或搜索摘要。URL 校验只能检查形式，仍必须打开原文核验。
6. 新事实 revision=1、supersedes=null。纠错必须新 id、revision 加一、supersedes 指向上一有效版本，身份 code/asset_id/metric_id 及 unit/data_date 保持一致，note 说明更正。旧记录不能删除、改写或重排。日期不同的独立新观察使用新链，不当作旧观察的修订。更正原单位或日期时，先以gap修订撤回错误链，再以正确单位/日期开新链并在note互相说明，禁止无声换算或求差。
7. 在仓库内执行：

```sh
python scripts/reviewed_evidence.py --check-history
python scripts/reviewed_evidence.py --append /path/to/new-evidence.json --check-history --apply
python -m pytest tests/test_reviewed_evidence.py tests/test_risk_data.py
```

`--apply` 只编译全局 `docs/data/reviewed-index.json` 并更新已有 `risk-stocks/*.json` 的 reviewed_evidence 独立字段，不请求任何行情 API，不改自动数据。没有股票详情文件也能由全局索引读取证据。索引保留全部修订历史，并为每条计算 available_at=max(observed_at,published_at)。历史查询先筛选当时已可知版本，再选修订链末，gap修订也保留，不能跳过后退回旧值。公布时间不明的记录仅用于当前核验区，不作过去已知事实。

8. 检查 git diff：旧 records 原样保留、没有凭证和私密信息、来源链接可用，记录/单位/日期无误。按项目既有发布授权流程提交源、生成索引与受影响详情，保留 Git 历史；未成功发布不得报告已填入网站。无新增可靠事实可以只追加 gap，并明确仍缺失；不重复每天制造相同 gap。

`--check-history` 对照当前 HEAD 验证工作区只追加；这是提交前检查，不等同于追溯审计所有旧提交。代码不自动搜索、不自动推断、不自动承诺已核验。

CI 已提交补丁审查必须用 `--check-history --base-ref <可信基线提交SHA>`（PR base 或已验证主分支SHA），不要以待审HEAD自比。先fetch所需提交，基线不可读会失败；首次引入文件才允许基线无该文件。

撤回约定：`kind=gap,status=unknown,value=null,supersedes=旧记录id` 表示旧事实暂时撤回。即使无法给出 published_at，也必须在 observed_at 到达后压制被撤回旧值。前端先按 known/available 时间挑修订链末，再判断该版本是否具有足够出版时间/数据日期可展示，绝不能先过滤无出版时间的撤回再复活旧值。确认撤回不代表证明相反事实。

长期资金字段：可选 report_period_end（统计期末）、document_date（原文落款日）、entity（实名主体）、action_scope（A/H股、持仓/流量/计划等范围）均应按原文填写。落款日不等于公布时刻；发布日期只到天时，在note注明，不伪造published_at。四类风向标catalog可有asset_id，证据不足的类别保持待核验，不补造总体数值。
