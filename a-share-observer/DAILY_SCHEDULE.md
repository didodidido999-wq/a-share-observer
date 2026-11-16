# Post-close collection and verification

All times below are Asia/Shanghai (UTC+8). GitHub cron expressions are UTC.

- 15:30: start the main market archive update.
- 15:35: incremental representative-stock daily histories.
- 15:40: daily sector breadth using the existing weekly constituent snapshot.
- 15:45: recovery check; fetch only missing/incomplete modules.
- 15:50: retry the main archive if the source was not ready.
- 16:05: retry sector coverage.
- 16:15: second recovery check.
- Every completed main-update workflow also triggers the recovery workflow on `main`, including failed main attempts. Recovery does not trigger itself.

All four writers share a non-cancelling concurrency queue and check out current `main`. These are requested start times, not guaranteed finish times or an SLA: GitHub can delay/drop scheduled events and queued writers may start later. An independent website freshness check is still required; an active workflow or green auxiliary collector does not prove today's primary archive exists.

The collector eligibility boundary is 15:30 on an actual exchange trading day. This only allows an attempt: source dates, same-day snapshots, required coverage and stale-data rejection remain mandatory. Weekends and holidays resolve to the latest verified closed session. No missing observations are filled with zero or relabeled from another date.

Sunday's weekly constituent refresh and Saturday's event/feedback refresh retain their previous schedules. Editing the sector workflow now runs the daily mode rather than triggering an expensive weekly constituent refresh.

Success must be checked against the expected trading date in `dates.json`, that day's main archive, representative coverage, sector quality and the actual deployed site. Partial sector coverage remains explicitly partial and the recovery verification fails visibly; it must not be changed to success simply to clear the check.
