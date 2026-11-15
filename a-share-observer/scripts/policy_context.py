"""Validate manually verified policy context; never scrape guesses into published facts."""
import argparse
import json
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

def timestamp(value):
    if not value or 'T' not in value:
        raise ValueError('Timezone-aware timestamp required')
    result=datetime.fromisoformat(value.replace('Z','+00:00'))
    if result.tzinfo is None:
        raise ValueError('Timezone required')
    return result

def validate(data):
    timestamp(data['checked_at'])
    seen=set()
    for kind in ('records','events'):
        for r in data[kind]:
            if r['id'] in seen: raise ValueError('Duplicate ID')
            seen.add(r['id'])
            if not r['source_url'].startswith('https://'): raise ValueError('HTTPS source required')
            if kind=='records' and r.get('published_precision')=='date':
                if r.get('published_at') is not None: raise ValueError('Do not fabricate publication timestamp')
                day=datetime.strptime(r['published_date'],'%Y-%m-%d')
                public=timestamp(r['availability_boundary'])
                expected=timestamp((day+timedelta(days=1)).strftime('%Y-%m-%dT00:00:00+08:00'))
                if public!=expected: raise ValueError('Date precision requires next-day conservative boundary')
            else:
                public=timestamp(r['published_at'] if kind=='records' else r['announced_at'])
            observed=timestamp(r['observed_at'])
            available=timestamp(r['available_at'])
            if available<max(public,observed): raise ValueError('Backdated availability')
            if kind=='records':
                if r['kind'] not in ('statistic','official_commentary','policy'): raise ValueError('Unknown fact class')
                if not r['limitations'] or not r['interpretation']: raise ValueError('Scope and inference required')
                if r.get('supersedes')==r['id']: raise ValueError('Self revision')
            else:
                timestamp(r['scheduled_at'])
                if r['result'] and not r.get('result_published_at'): raise ValueError('Result needs publication time')
                if r.get('result_published_at'): timestamp(r['result_published_at'])
    return data

def check_history(base, current):
    for key in ('records','events'):
        now={r['id']:r for r in current[key]}
        for old in base.get(key,[]):
            if now.get(old['id'])!=old:
                raise ValueError(f'Immutable {key} record altered or removed: {old["id"]}')
    return True

def check_git_base(path, ref):
    root=Path(subprocess.check_output(['git','rev-parse','--show-toplevel'],cwd=path.parent,text=True).strip())
    subprocess.run(['git','rev-parse','--verify',ref+'^{commit}'],cwd=root,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    rel=path.resolve().relative_to(root).as_posix()
    names=subprocess.check_output(['git','ls-tree','--name-only',ref,'--',rel],cwd=root,text=True).splitlines()
    if rel not in names:
        return 'Initial file: no older records in verified base commit'
    old=json.loads(subprocess.check_output(['git','show',ref+':'+rel],cwd=root,text=True))
    check_history(old,json.loads(path.read_text()))
    return 'Existing records and events unchanged'

def append(base, addition):
    """Append-only records/events; historical versions cannot be replaced."""
    result=json.loads(json.dumps(base))
    for key in ('records','events'):
        result[key].extend(addition.get(key,[]))
    result['checked_at']=addition['checked_at']
    return validate(result)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--file',type=Path,default=Path(__file__).resolve().parents[1]/'docs/data/policy-context.json')
    parser.add_argument('--append',type=Path)
    parser.add_argument('--git-base',help='CI base commit/ref; validate immutable existing records')
    args=parser.parse_args()
    data=validate(json.loads(args.file.read_text()))
    if args.append:
        data=append(data,json.loads(args.append.read_text()))
        args.file.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    if args.git_base: print(check_git_base(args.file,args.git_base))
    print(f"Validated {len(data['records'])} records and {len(data['events'])} scheduled events")
