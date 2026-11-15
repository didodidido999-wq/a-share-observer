"""Append-only public evidence, kept separate from automated observations."""
from __future__ import annotations
import argparse, ipaddress, json, math, re, subprocess
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'docs/data/reviewed-evidence.json'
UNITS={'%','bp','元','万元','亿元','股','万股','亿股','倍','点','家','只','天','美元','人民币','吨','元/吨','美元/桶','美元/盎司','USD','CNY'}
REQUIRED={'id','revision','supersedes','kind','metric_id','value','unit','data_date','published_at','observed_at','source_url','source_title','note','status'}

def timestamp(v):
    if not isinstance(v,str):raise ValueError('timestamp must be ISO text with timezone')
    try:d=datetime.fromisoformat(v.replace('Z','+00:00'))
    except ValueError:raise ValueError('invalid timestamp') from None
    if d.tzinfo is None:raise ValueError('timestamp requires timezone')
    if d.year<2000:raise ValueError('timestamp outside supported era')
    return d

def public_url(v):
    if not isinstance(v,str):raise ValueError('source URL required')
    p=urlsplit(v);host=p.hostname or ''
    if p.scheme!='https' or p.username or p.password or '.' not in host or host.endswith(('.local','.localhost','.internal')):raise ValueError('public HTTPS source required')
    try:
        if not ipaddress.ip_address(host).is_global:raise ValueError('public source required')
    except ValueError as e:
        if str(e)=='public source required':raise
    if host in ['localhost','127.0.0.1']:raise ValueError('public source required')

def validate(doc, previous=None, now=None):
    now=now or datetime.now(timezone.utc)
    if doc.get('schema_version')!=1 or not isinstance(doc.get('records'),list) or not isinstance(doc.get('catalog'),list):raise ValueError('invalid evidence document')
    rows=doc['records'];seen={};replaced=set()
    if previous is not None:
        old=previous.get('records',[])
        if rows[:len(old)]!=old:raise ValueError('append-only: existing records must remain unchanged and ordered')
    for r in rows:
        if not isinstance(r,dict) or not REQUIRED<=r.keys():raise ValueError('record missing required fields')
        if bool(r.get('code'))==bool(r.get('asset_id')):raise ValueError('exactly one code or asset_id required')
        if r.get('code') and not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',r['code']):raise ValueError('invalid stock code')
        for field in ['id','metric_id']+(['asset_id'] if r.get('asset_id') else []):
            if not isinstance(r[field],str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,100}',r[field]):raise ValueError('invalid identifier')
        if r['id'] in seen:raise ValueError('duplicate id')
        if type(r['revision']) is not int or r['revision']<1:raise ValueError('invalid revision')
        if r['kind'] not in ['metric','event','gap'] or r['status'] not in ['verified','unknown','not_found']:raise ValueError('invalid kind/status')
        if r['kind']=='gap':
            if r['value'] is not None or r['status']=='verified':raise ValueError('gap must be unknown/not_found with null value')
        elif r['status']!='verified':raise ValueError('unverified observation must be a gap')
        if r['kind']=='metric' and (type(r['value']) not in [int,float] or not math.isfinite(r['value'])):raise ValueError('metric must be finite number, never missing-as-zero')
        if r['kind']=='event' and r['value'] is not None:raise ValueError('event value must be null')
        for field in ['unit','source_title','note']:
            if not isinstance(r[field],str) or (field!='unit' and not r[field].strip()):raise ValueError('text fields required')
        if r['kind']=='metric' and r['unit'] not in UNITS:raise ValueError('unsupported metric unit')
        if r['kind']=='metric' and r['metric_id'] in ['pledge_ratio','financing_ratio'] and (r['unit']!='%' or not 0<=r['value']<=100):raise ValueError('ratio requires percent in 0..100')
        observed=timestamp(r['observed_at'])
        if observed>now:raise ValueError('future observed_at')
        if r['published_at'] is not None:
            published=timestamp(r['published_at'])
            if published>observed:raise ValueError('publication must precede observation')
        if r['data_date'] is not None:
            try:d=date.fromisoformat(r['data_date'])
            except (ValueError,TypeError):raise ValueError('invalid data_date') from None
            if d<date(2000,1,1) or d>observed.date():raise ValueError('future data_date: put announced future schedules in note, not observations')
        elif r['kind']!='gap':raise ValueError('verified record requires data_date')
        for field in ['report_period_end','document_date']:
            if r.get(field) is not None:
                try: extra_day=date.fromisoformat(r[field])
                except (ValueError,TypeError):raise ValueError('invalid '+field) from None
                if not date(2000,1,1)<=extra_day<=observed.date():raise ValueError('future or invalid '+field)
        for field in ['entity','action_scope']:
            if field in r and (not isinstance(r[field],str) or not r[field].strip()):raise ValueError('invalid '+field)
        public_url(r['source_url'])
        prior=r['supersedes']
        if prior is None:
            if r['revision']!=1:raise ValueError('first revision must be 1')
        else:
            old=seen.get(prior)
            if not old or prior in replaced:raise ValueError('supersedes must target one active earlier record')
            if r['revision']!=old['revision']+1:raise ValueError('revision must increment')
            if any(r.get(k)!=old.get(k) for k in ['code','asset_id','metric_id','unit','data_date']):raise ValueError('revision identity mismatch')
            if observed<timestamp(old['observed_at']):raise ValueError('revision observation moves backward')
            replaced.add(prior)
        seen[r['id']]=r
    for item in doc['catalog']:
        if not isinstance(item,dict) or not all(isinstance(item.get(k),str) and item[k] for k in ['metric_id','label','status','note']):raise ValueError('invalid pending catalog')
        if item['status']!='pending':raise ValueError('catalog contains no factual observations')
    return [r for r in rows if r['id'] not in replaced]

def atomic(path,obj,compact=False):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(obj,ensure_ascii=False,indent=None if compact else 2,separators=(',',':') if compact else None,allow_nan=False)+'\n');tmp.replace(path)

def compile_index(doc):
    validate(doc);records=doc['records'];out={'schema_version':1,'generated_at':datetime.now(timezone.utc).isoformat(),'by_code':{},'by_asset':{},'catalog':doc['catalog']}
    for r in records:
        available=max(timestamp(r['observed_at']),timestamp(r['published_at'])) if r['published_at'] else timestamp(r['observed_at'])
        enriched={**r,'available_at':available.isoformat()}
        out['by_code' if r.get('code') else 'by_asset'].setdefault(r.get('code') or r['asset_id'],[]).append(enriched)
    return out

def apply(source=SOURCE):
    doc=json.loads(source.read_text());index=compile_index(doc)
    # All existing stock files are touched, so a correction never leaves superseded evidence behind.
    for path in (source.parent/'risk-stocks').glob('*.json'):
        obj=json.loads(path.read_text());records=index['by_code'].get(obj.get('code'),[])
        if records:
            if obj.get('reviewed_evidence')!=records:obj['reviewed_evidence']=records;atomic(path,obj,compact=True)
        elif 'reviewed_evidence' in obj:
            obj.pop('reviewed_evidence');atomic(path,obj,compact=True)
    atomic(source.parent/'reviewed-index.json',index)
    return index

def main():
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,default=SOURCE);p.add_argument('--append',type=Path);p.add_argument('--check-history',action='store_true');p.add_argument('--base-ref',default='HEAD');p.add_argument('--apply',action='store_true');a=p.parse_args()
    doc=json.loads(a.source.read_text());previous=None
    if a.check_history:
        root=subprocess.check_output(['git','rev-parse','--show-toplevel'],cwd=ROOT,text=True).strip();rel=a.source.resolve().relative_to(root)
        proc=subprocess.run(['git','show',a.base_ref+':'+str(rel)],cwd=root,text=True,capture_output=True)
        if proc.returncode==0:previous=json.loads(proc.stdout)
        else:
            if subprocess.run(['git','rev-parse','--verify',a.base_ref+'^{commit}'],cwd=root,capture_output=True).returncode!=0:raise ValueError('baseline commit unavailable; fetch history before validating')
            if subprocess.run(['git','cat-file','-e',a.base_ref+':'+str(rel)],cwd=root,capture_output=True).returncode==0:raise ValueError('cannot read evidence baseline')
    validate(doc,previous)
    if a.append:
        incoming=json.loads(a.append.read_text());incoming=incoming if isinstance(incoming,list) else [incoming]
        new={**doc,'records':doc['records']+incoming};validate(new,doc);atomic(a.source,new);doc=new
    if a.apply:apply(a.source)
    print(json.dumps({'records':len(doc['records']),'active':len(validate(doc)),'applied':a.apply}))
if __name__=='__main__':main()
