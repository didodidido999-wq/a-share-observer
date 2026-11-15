import importlib.util
import json
from pathlib import Path
import unittest
P=Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('policy_context',P/'scripts/policy_context.py')
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class PolicyTests(unittest.TestCase):
 def setUp(self): self.d=json.loads((P/'docs/data/policy-context.json').read_text())
 def test_valid(self): m.validate(self.d)
 def test_backdate(self):
  self.d['records'][0]['available_at']='2026-01-01T00:00:00Z'
  with self.assertRaises(ValueError): m.validate(self.d)
 def test_no_duplicate_append(self):
  with self.assertRaises(ValueError): m.append(self.d,{'checked_at':self.d['checked_at'],'records':[self.d['records'][0]]})
 def test_result_timestamp(self):
  self.d['events'][0]['result']='actual'
  with self.assertRaises(ValueError):m.validate(self.d)
if __name__=='__main__':unittest.main()

class HistoryTests(unittest.TestCase):
 def test_immutable_record(self):
  old={'records':[{'id':'a','value':1}],'events':[]}
  with self.assertRaises(ValueError):m.check_history(old,{'records':[{'id':'a','value':2}],'events':[]})
 def test_append_preserved(self):
  self.assertTrue(m.check_history({'records':[{'id':'a'}],'events':[]},{'records':[{'id':'a'},{'id':'b'}],'events':[]}))
 def test_deleted_event(self):
  with self.assertRaises(ValueError):m.check_history({'records':[],'events':[{'id':'a'}]},{'records':[],'events':[]})
