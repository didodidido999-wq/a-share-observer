import copy
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from research_readiness import readiness

class ReadinessTests(unittest.TestCase):
    def setUp(self):
        self.now=datetime(2026,11,16,8,tzinfo=timezone.utc)
        self.cal={'source_url':'https://example.com/calendar','verified_at':'2026-11-01T00:00:00Z','coverage_start':'2026-11-01','coverage_end':'2026-12-01','sessions':['2026-11-13','2026-11-16','2026-11-17']}
        self.row={'date':'2026-11-16','market':{'date':'2026-11-16','up':1,'down':2,'flat':0},'indices':[{'code':'000300.SH','close':4000}], 'sectors':[{'date':'2026-11-16','close':1}]*400,'quality_manifest':{k:{'trade_date':'2026-11-16','collected_at':'2026-11-16T07:40:00Z','status':'complete','items_count':710,'expected_count':710} for k in ('sector_members','sector_internal_metrics','sector_focus_stocks')}}
    def run_gate(self):
        with patch('research_readiness.load_archives',return_value=[self.row]), patch('research_readiness.read',return_value=self.cal):
            return readiness(Path('/unused'),self.now)
    def test_ready(self): self.assertTrue(self.run_gate()['ready'])
    def test_stale(self):
        self.row['date']='2026-11-13'
        with self.assertRaises(ValueError): self.run_gate()
    def test_partial_is_honest(self):
        self.row['quality_manifest']['sector_internal_metrics'].update(status='partial',items_count=709)
        self.assertIn('partial 709/710',self.run_gate()['warnings'][0])
    def test_low_partial_blocks(self):
        self.row['quality_manifest']['sector_internal_metrics'].update(status='partial',items_count=600)
        with self.assertRaises(ValueError): self.run_gate()
    def test_future_observation_blocks(self):
        self.row['quality_manifest']['sector_members']['collected_at']='2026-11-17T07:00:00Z'
        with self.assertRaises(ValueError): self.run_gate()
    def test_old_sector_blocks(self):
        self.row['quality_manifest']['sector_members']['trade_date']='2026-11-13'
        with self.assertRaises(ValueError): self.run_gate()
    def test_weekend_uses_last_close(self):
        self.now=datetime(2026,11,15,8,tzinfo=timezone.utc)
        self.row['date']=self.row['market']['date']='2026-11-13'
        for s in self.row['sectors']: s['date']='2026-11-13'
        for q in self.row['quality_manifest'].values(): q.update(trade_date='2026-11-13',collected_at='2026-11-13T08:00:00Z')
        self.assertEqual(self.run_gate()['target_date'],'2026-11-13')
    def test_before_close_blocks(self):
        self.now=datetime(2026,11,16,6,tzinfo=timezone.utc)
        with self.assertRaises(ValueError): self.run_gate()

if __name__ == '__main__': unittest.main()
