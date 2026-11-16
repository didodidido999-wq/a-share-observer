import importlib.util,json,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import backfill_macro as b

def item(rows):return {'id':'cgb_2y','unit':'%','rows':rows}
def test_append_preserves_old_rows_and_does_not_fill_dates():
 old=item([{'date':'2026-06-10','value':1}]);new=item([{'date':'2026-06-12','value':2}]);merged=b.merge_macro([old],[new],'2026-06-10')[0]
 assert merged['rows']==old['rows']+new['rows']
 assert merged['history_backfill']['added_rows']==1

def test_conflict_aborts_instead_of_rewriting_history():
 with pytest.raises(ValueError,match='Conflicting historical'):
  b.merge_macro([item([{'date':'2026-06-10','value':1}])],[item([{'date':'2026-06-10','value':2}])],'2026-06-10')

def test_macro_copies_match_and_reach_100_observations():
 docs=[json.loads((ROOT/'docs/data'/f).read_text())['macro'] for f in ['risk-macro.json','risk-observer.json']]
 assert docs[0]==docs[1]
 for series in docs[0]:
  assert len(series['rows'])>=100
  assert series['rows'][0]['date']=='2026-06-10'
  assert series['publication_time_verified'] is False
  assert len({r['date'] for r in series['rows']})==len(series['rows'])
