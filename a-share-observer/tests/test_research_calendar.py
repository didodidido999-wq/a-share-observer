"""Validate reviewed 2026 remaining-year exchange calendar, independent of price archives."""
import json
from datetime import date,timedelta,datetime
from pathlib import Path
import unittest
class CalendarTests(unittest.TestCase):
 def test_verified_calendar(self):
  c=json.loads((Path(__file__).resolve().parents[1]/'docs/data/research-calendar.json').read_text())
  self.assertEqual(c['source_url'],'https://www.sse.com.cn/disclosure/announcement/general/c/c_20251222_10802507.shtml')
  self.assertIsNotNone(datetime.fromisoformat(c['verified_at'].replace('Z','+00:00')).tzinfo)
  start=date.fromisoformat(c['coverage_start']);end=date.fromisoformat(c['coverage_end'])
  self.assertEqual(end,date(2026,12,31));expected=[];d=start
  while d<=end:
   if d.weekday()<5:expected.append(d.isoformat())
   d+=timedelta(days=1)
  self.assertEqual(c['sessions'],expected)
  self.assertEqual(len(expected),35)
  self.assertNotIn('2026-11-15',expected)
  self.assertIn('2026-12-31',expected)
if __name__=='__main__':unittest.main()
