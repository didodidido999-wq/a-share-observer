import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from research_publication import matches

def test_exact_forecast_required():
    local={'current':{'id':'a','evidence':[1], 'judgment':'down'}}
    assert matches(local,{'current':dict(local['current'])})
    assert not matches(local,{'current':{'id':'a','evidence':[2], 'judgment':'down'}})
    assert not matches(local,{'current':{'id':'b','evidence':[1], 'judgment':'down'}})
    assert not matches(local,{})
