"""Confirm the exact frozen research is public before activating prospective evaluation."""
import argparse
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen
from research_ledger import digest

PUBLIC_URL = 'https://www.aniu999.com/data/research-current.json'

def matches(local, remote):
    return isinstance(remote, dict) and isinstance(remote.get('current'), dict) and digest(local['current']) == digest(remote['current'])

def verify(path, attempts=40, delay=15):
    local=json.loads(path.read_text())
    for attempt in range(attempts):
        try:
            req=Request(PUBLIC_URL+'?verification='+str(time.time_ns()), headers={'Cache-Control':'no-cache','User-Agent':'MarketScope-research-publication-check'})
            with urlopen(req, timeout=20) as response:
                remote=json.load(response)
            if matches(local,remote):
                return local['current']['id']
        except Exception as exc:
            print('Publication check pending:', type(exc).__name__, flush=True)
        if attempt+1<attempts: time.sleep(delay)
    raise RuntimeError('Exact frozen research not verified public; no prospective activation permitted')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--file',type=Path,default=Path(__file__).resolve().parents[1]/'docs/data/research-current.json')
    p.add_argument('--attempts',type=int,default=40)
    p.add_argument('--output',type=Path,help='Write the verified forecast ID for the activation step')
    a=p.parse_args()
    identifier=verify(a.file,a.attempts)
    if a.output:a.output.write_text(identifier+'\n')
    print('Exact public forecast verified:',identifier)
