import os
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy.exc import SQLAlchemyError

os.environ.setdefault('DATABASE_URL', 'postgresql://test:test@localhost:5432/testdb')
os.environ.setdefault('ALLOWED_ORIGINS', 'http://testserver')
os.environ.setdefault('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
os.environ.setdefault('SUPABASE_SERVICE_ROLE_KEY', 'fake-service-key')


@pytest.fixture(scope='module')
def client():
    with patch('main.connect_to_database', return_value=True), patch('main.warmup_system', return_value=None):
        from fastapi.testclient import TestClient
        import main as app_module
        import database as db_module

        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_engine.connect.return_value = mock_conn
        db_module.db_engine = mock_engine

        with TestClient(app_module.app) as c:
            yield c


def _mapping_result(row):
    result = MagicMock()
    mappings = MagicMock()
    mappings.first.return_value = row
    result.mappings.return_value = mappings
    return result


def test_get_medication_guide_returns_cached_row(client):
    import database as db_module

    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_engine.connect.return_value = mock_conn

    executed_sql = []

    pill_row = {
        'rxcui': '123',
        'ndc11': '12345-6789-01',
        'ndc9': '12345-6789',
        'medicine_name': 'aspirin',
        'spl_set_id': 'set-1',
    }
    cache_row = {
        'rxcui': '123',
        'ndc': '12345-6789-01',
        'generic_name': 'aspirin',
        'brand_name': 'Bayer',
        'has_boxed_warning': False,
        'overview': '<p>Overview</p>',
        'uses': '<p>Uses</p>',
        'dosage': None,
        'how_to_take': None,
        'side_effects': None,
        'warnings': None,
        'interactions': None,
        'contraindications': None,
        'special_populations': None,
        'overdose': None,
        'storage': None,
        'pharmacology': None,
        'manufacturer': None,
        'professional_html': '<html></html>',
        'source_url': 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=set-1',
        'fetched_at': datetime(2026, 1, 1, tzinfo=timezone.utc),
        'disclaimer': 'Source: FDA Structured Product Labeling via DailyMed',
    }

    def side_effect(sql, params=None):
        sql_str = str(sql)
        executed_sql.append(sql_str)
        if 'FROM pillfinder' in sql_str:
            return _mapping_result(pill_row)
        if 'FROM drug_medication_guides' in sql_str:
            return _mapping_result(cache_row)
        raise AssertionError(f'Unexpected SQL: {sql_str}')

    mock_conn.execute.side_effect = side_effect
    db_module.db_engine = mock_engine

    resp = client.get('/api/drugs/123/guide')
    assert resp.status_code == 200
    data = resp.json()
    assert data['rxcui'] == '123'
    assert data['sections']['overview'] == '<p>Overview</p>'
    assert data['professional_html'] == '<html></html>'
    assert not any('INSERT INTO drug_medication_guides' in q for q in executed_sql)


def test_get_medication_guide_returns_503_when_cache_table_missing(client):
    import database as db_module

    mock_engine = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__ = MagicMock(return_value=mock_conn)
    mock_conn.__exit__ = MagicMock(return_value=False)
    mock_engine.connect.return_value = mock_conn

    pill_row = {
        'rxcui': '123',
        'ndc11': '12345-6789-01',
        'ndc9': '12345-6789',
        'medicine_name': 'aspirin',
        'spl_set_id': 'set-1',
    }

    def side_effect(sql, params=None):
        sql_str = str(sql)
        if 'FROM pillfinder' in sql_str:
            return _mapping_result(pill_row)
        if 'FROM drug_medication_guides' in sql_str:
            raise SQLAlchemyError('relation "drug_medication_guides" does not exist')
        raise AssertionError(f'Unexpected SQL: {sql_str}')

    mock_conn.execute.side_effect = side_effect
    db_module.db_engine = mock_engine

    resp = client.get('/api/drugs/123/guide')
    assert resp.status_code == 503
    assert 'cache table is unavailable' in resp.json()['detail']
