import sys
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from provider_dates import validate_response_dates

def test_response_and_row_dates_must_match():
    assert validate_response_dates({'date':'2026-11-13','item':[{'trade_date':'20261113'}]},'2026-11-13')
    with pytest.raises(ValueError): validate_response_dates({'date':'2026-11-13','item':[{'date':'2026-11-12'}]},'2026-11-13')

def test_no_date_is_not_independent_proof_and_retrieval_timestamp_ignored():
    assert not validate_response_dates({'timestamp':9999999999999,'item':[{'thscode':'A'}]},'2026-11-13')
