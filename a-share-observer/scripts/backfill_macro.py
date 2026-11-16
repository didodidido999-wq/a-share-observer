"""Source-dated macro backfill only; never touches stock observations or fills gaps.
Existing conflicting values abort the write for explicit review. Public-source
observations retain their date, not an invented historic publication timestamp.
"""
from __future__ import annotations
import argparse,json
from datetime import date,datetime
from pathlib import Path
import risk_data as r
START='2026-06-10'

def merge_macro(prior,incoming,start,verified_at=None):
    old={x['id']:x for x in prior};result=[]
    for item in incoming:
        previous=old.pop(item['id'],None)
        if previous and previous.get('unit')!=item.get('unit'):raise ValueError('Unit mismatch: '+item['id'])
        rows={x['date']:x for x in (previous or {}).get('rows',[])}
        fresh=0
        for row in item['rows']:
            if row['date']<start:continue
            if row['date'] in rows:
                if rows[row['date']]['value']!=row['value']:raise ValueError('Conflicting historical observation: '+item['id']+' '+row['date'])
            else:rows[row['date']]=row;fresh+=1
        if not rows:raise ValueError('No observed rows: '+item['id'])
        result.append({**item,'rows':[rows[d] for d in sorted(rows)],'history_backfill':{'requested_start':start,'verified_at':verified_at or datetime.now(r.TZ).isoformat(),'added_rows':fresh+(previous or {}).get('history_backfill',{}).get('added_rows',0),'note':'Only dated provider observations appended; no date filling. Historical publication timestamps remain unverified.'}})
    return result+list(old.values())

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--start',default=START);parser.add_argument('--source-dir',type=Path);args=parser.parse_args()
    if date.fromisoformat(args.start)>datetime.now(r.TZ).date():raise ValueError('Future backfill start')
    if args.source_dir:
        treasury=json.loads((args.source_dir/'treasury.json').read_text());shibor=json.loads((args.source_dir/'shibor.json').read_text())
    else:
        treasury=r.fetch_report('RPTA_WEB_TREASURYYIELD','SOLAR_DATE',f"(SOLAR_DATE>='{args.start}')",500,6)
        shibor=r.fetch_report('RPT_IMP_INTRESTRATEN','REPORT_DATE',f'''(MARKET_CODE="001")(CURRENCY_CODE="CNY")(REPORT_DATE>='{args.start}')''',500,6)
    incoming=r.parse_macro(treasury,shibor)
    if not all(x['rows'] for x in incoming):raise ValueError('One or more required macro series absent')
    paths=[r.OUT.parent/'risk-macro.json',r.OUT];outputs=[];verified_at=datetime.now(r.TZ).isoformat()
    for path in paths:
        doc=json.loads(path.read_text());doc['macro']=merge_macro(doc.get('macro',[]),incoming,args.start,verified_at);outputs.append((path,doc))
    for path,doc in outputs:r.atomic_json(path,doc)
    print(json.dumps([{'id':x['id'],'rows':len(x['rows']),'first':x['rows'][0]['date'],'last':x['rows'][-1]['date'],'added':x['history_backfill']['added_rows']} for x in outputs[0][1]['macro']],ensure_ascii=False))
if __name__=='__main__':main()
