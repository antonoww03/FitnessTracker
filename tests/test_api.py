"""Offline regression coverage. Never contacts a deployed app or real food provider."""
import csv
import io
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import httpx
import pytest
from fastapi.testclient import TestClient
from backend import server

DAY = '2026-09-17'
FOOD = dict(date=DAY, food_name='Rice', food_description='100 g rice', calories=130, protein=2.7, fat=.3, carbs=28, sugar=0, fiber=.4)


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('FITTRACK_AUTO_BACKUP','0')
    monkeypatch.setattr(server, 'DB_PATH', tmp_path / 'data.sqlite3')
    monkeypatch.delenv('USDA_API_KEY', raising=False)
    monkeypatch.setenv('FITTRACK_AUTH_DISABLED', '1')
    with TestClient(server.app) as client:
        yield client


def test_health_defaults_empty_day(client):
    assert client.get('/api').json() == {'status': 'ok'}
    data = client.get('/api/summary', params={'date': DAY}).json()
    assert data['totals'] == dict.fromkeys(server.MACROS, 0)
    assert data['goals'] == server.DEFAULT_GOALS
    assert data['weight_kg'] is None
    assert data['food_count'] == data['training_count'] == 0


def test_food_training_water_crud_and_summary(client):
    food = client.post('/api/food', json=FOOD).json()
    training = client.post('/api/training', json=dict(date=DAY, training_type='Strength', duration_minutes=45)).json()
    water = client.post('/api/water', json=dict(date=DAY, amount_ml=500)).json()
    for kind, record in [('food', food), ('training', training), ('water', water)]:
        assert record['id'] and record['timestamp']
        assert client.get(f'/api/{kind}', params={'date': DAY}).json() == [record]
        assert client.get(f'/api/{kind}?date=2026-09-16').json() == []
    totals = client.get(f'/api/summary?date={DAY}').json()
    assert totals['totals']['calories'] == 130
    assert totals['total_training_minutes'] == 45
    assert totals['total_water_ml'] == 500
    assert totals['food_count'] == totals['training_count'] == 1
    for kind, record in [('food', food), ('training', training), ('water', water)]:
        assert client.delete(f"/api/{kind}/{record['id']}").status_code == 200
        assert client.delete(f"/api/{kind}/{record['id']}").status_code == 404


def test_goals_and_weight_upsert(client):
    goals = {**server.DEFAULT_GOALS, 'calories': 2800, 'sugar': 0}
    assert client.put('/api/goals', json=goals).json() == goals
    assert client.get('/api/goals').json() == goals
    assert client.get(f'/api/summary?date={DAY}').json()['goals'] == goals
    for weight in (73.5, 74):
        assert client.post('/api/weight', json=dict(date=DAY, weight_kg=weight)).json()['weight_kg'] == weight
    assert len(server.records('weight')) == 1
    assert client.get(f'/api/weight?date={DAY}').json()['weight_kg'] == 74
    client.post('/api/weight', json=dict(date='2026-09-16', weight_kg=70))
    assert client.get('/api/weight').json()['weight_kg'] == 74
    assert client.get(f'/api/summary?date={DAY}').json()['weight_kg'] == 74
    assert client.delete(f'/api/weight/{DAY}').status_code == 200
    assert client.get(f'/api/weight?date={DAY}').json() is None


def test_water_reset_and_streak_gaps_future(client):
    anchor = date.fromisoformat(DAY)
    for delta in (-3, -2, -1, 1):
        client.post('/api/water', json=dict(date=str(anchor + timedelta(days=delta)), amount_ml=250))
    assert client.get(f'/api/streak/water?date={DAY}').json()['streak'] == 3
    for _ in range(2):
        client.post('/api/water', json=dict(date=DAY, amount_ml=250))
    assert client.get(f'/api/streak/water?date={DAY}').json()['streak'] == 4
    client.delete(f'/api/water?date={DAY}')
    assert client.get(f'/api/summary?date={DAY}').json()['total_water_ml'] == 0
    client.delete('/api/water?date=2026-09-16')
    assert client.get(f'/api/streak/water?date={DAY}').json()['streak'] == 0
    assert len(client.get('/api/water?date=2026-09-15').json()) == 1


@pytest.mark.parametrize('endpoint,payload', [
    ('food', {**FOOD, 'calories': -1}), ('food', {**FOOD, 'food_name': ' '}),
    ('food', {**FOOD, 'date': '2026-02-30'}), ('food', {**FOOD, 'protein': 'NaN'}),
    ('training', dict(date=DAY, training_type='Other', duration_minutes=30)),
    ('training', dict(date=DAY, training_type='Strength', duration_minutes=1.5)),
    ('training', dict(date=DAY, training_type='Strength', duration_minutes=0)),
    ('training', dict(date=DAY, training_type='Strength', duration_minutes=1441)),
    ('water', dict(date=DAY, amount_ml=-1)), ('water', dict(date=DAY, amount_ml=0)),
    ('water', dict(date='bad', amount_ml=250)), ('water', dict(date=DAY, amount_ml='Infinity')),
    ('weight', dict(date=DAY, weight_kg=0)), ('weight', dict(date=DAY, weight_kg=-75)),
])
def test_invalid_entries_rejected(client, endpoint, payload):
    assert client.post(f'/api/{endpoint}', json=payload).status_code == 422
    assert server.records(endpoint) == []


@pytest.mark.parametrize('endpoint', ['food', 'water', 'training', 'weight', 'summary', 'reports', 'coach/tips', 'streak/water'])
def test_invalid_query_dates(client, endpoint):
    assert client.get(f'/api/{endpoint}?date=not-a-date').status_code == 422


def test_invalid_goals(client):
    assert client.put('/api/goals', json={'calories': -1}).status_code == 422
    assert client.get('/api/goals').json() == server.DEFAULT_GOALS


def test_reports_snapshots_filters_and_exports(client):
    client.post('/api/food', json=FOOD)
    client.post('/api/weight', json=dict(date=DAY, weight_kg=74))
    for day in [DAY, '2026-09-14', '2026-09-13', '2026-08-31', '2025-12-31']:
        assert client.post(f'/api/reports/save?date={day}').status_code == 200
    client.post(f'/api/reports/save?date={DAY}')
    assert len(client.get('/api/reports').json()) == 5
    assert len(client.get(f'/api/reports?period=week&date={DAY}').json()) == 2
    assert len(client.get(f'/api/reports?period=month&date={DAY}').json()) == 3
    assert len(client.get(f'/api/reports?period=year&date={DAY}').json()) == 4
    assert client.get('/api/reports?period=wrong').status_code == 422
    client.post('/api/food', json=FOOD)
    report = client.get('/api/reports').json()[0]
    assert report['totals']['calories'] == 260  # reports always reflect current entries
    assert report['weight_kg'] == 74
    assert report['food_count'] == 2
    exported = client.get(f'/api/export?format=csv&period=week&date={DAY}')
    rows = list(csv.DictReader(io.StringIO(exported.content.decode('utf-8-sig'))))
    assert len(rows) == 2 and float(rows[0]['calories']) == 260
    pdf = client.get('/api/export?format=pdf')
    assert pdf.headers['content-type'] == 'application/pdf'
    assert pdf.content.startswith(b'%PDF-')
    assert client.get('/api/export?format=exe').status_code == 400
    assert client.delete(f'/api/reports/{DAY}').status_code == 200
    assert client.delete(f'/api/reports/{DAY}').status_code == 404
    assert len(client.get(f'/api/food?date={DAY}').json()) == 2


def test_coach_is_based_on_data_and_custom_targets(client):
    assert client.get(f'/api/coach/tips?date={DAY}').json()['source'] == 'logged-data'
    client.post('/api/food', json=FOOD)
    client.put('/api/goals', json={**server.DEFAULT_GOALS, 'calories': 2800})
    data = client.get(f'/api/coach/tips?date={DAY}').json()
    assert data['totals']['calories'] == 130
    assert '2800' in data['tips'][0]['tip']


def test_persistence_across_processes(client):
    client.post('/api/food', json=FOOD)
    client.post('/api/water', json=dict(date=DAY, amount_ml=500))
    client.post('/api/weight', json=dict(date=DAY, weight_kg=74))
    client.put('/api/goals', json={**server.DEFAULT_GOALS, 'calories': 2800})
    client.post(f'/api/reports/save?date={DAY}')
    script = f"from backend.server import summary; from datetime import date; import json; print(json.dumps(summary(date.fromisoformat('{DAY}'))))"
    output = subprocess.check_output([sys.executable, '-c', script], env={**os.environ, 'FITTRACK_DB_PATH': str(server.DB_PATH)})
    summary = json.loads(output)
    assert summary['totals']['calories'] == 130
    assert summary['total_water_ml'] == 500 and summary['weight_kg'] == 74
    assert summary['goals']['calories'] == 2800


def test_concurrent_water_writes_do_not_get_lost(client):
    with ThreadPoolExecutor(max_workers=8) as pool:
        codes = list(pool.map(lambda _: client.post('/api/water', json=dict(date=DAY, amount_ml=250)).status_code, range(20)))
    assert codes == [200] * 20
    assert client.get(f'/api/summary?date={DAY}').json()['total_water_ml'] == 5000


def mock_usda(monkeypatch, handler):
    original = httpx.AsyncClient
    monkeypatch.setenv('USDA_API_KEY', 'test-key-never-logged')
    monkeypatch.setattr(server.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))


def nutrition():
    return {'foods': [{'description': 'Test food', 'foodNutrients': [
        {'nutrientId': nutrient, 'value': value, 'unitName': 'KCAL' if nutrient == 1008 else 'G'}
        for nutrient, value in [(1008, 100), (1003, 10), (1004, 2), (1005, 20), (2000, 1), (1079, 3)]
    ]}]}


def test_food_lookup_scales_and_sums_portions(client, monkeypatch):
    queries = []
    def handler(request):
        queries.append(request.url.params['query'])
        return httpx.Response(200, json=nutrition())
    mock_usda(monkeypatch, handler)
    data = client.post('/api/food/analyze', json={'description': '200 g chicken; 0.1 kg rice'}).json()
    assert data['calories'] == 300 and data['protein'] == 30
    assert queries == ['chicken', 'rice']
    assert server.records('food') == []  # analysis never writes a log


@pytest.mark.parametrize('description', ['2 eggs', '0 g rice', '100 g chicken with rice', '10001 g rice'])
def test_ambiguous_portions_rejected(client, monkeypatch, description):
    mock_usda(monkeypatch, lambda _: pytest.fail('Invalid input must not reach provider'))
    assert client.post('/api/food/analyze', json={'description': description}).status_code == 422


def test_provider_timeout_not_zero_calorie_success(client, monkeypatch):
    def handler(request):
        raise httpx.ReadTimeout('timeout', request=request)
    mock_usda(monkeypatch, handler)
    response = client.post('/api/food/analyze', json={'description': '100 g rice'})
    assert response.status_code == 504
    assert 'calories' not in response.json()


@pytest.mark.parametrize('status,payload,expected', [(429, {}, 502), (200, {'foods': []}, 404), (200, {'foods': [{'foodNutrients': []}]}, 422), (200, {'foods': [{'foodNutrients': [{'nutrientId': 1008, 'value': 'NaN'}]}]}, 502)])
def test_food_provider_errors(client, monkeypatch, status, payload, expected):
    mock_usda(monkeypatch, lambda _: httpx.Response(status, json=payload))
    response = client.post('/api/food/analyze', json={'description': '100 g rice'})
    assert response.status_code == expected
    assert 'test-key' not in response.text


def test_missing_provider_key(client):
    assert client.post('/api/food/analyze', json={'description': '100 g rice'}).status_code == 503
    assert client.post('/api/food', json=FOOD).status_code == 200


def test_barcode_lookup_maps_open_food_facts_per_100g(client, monkeypatch):
    original = httpx.AsyncClient
    seen = {}
    def handler(request):
        seen['url'] = str(request.url)
        seen['agent'] = request.headers.get('user-agent')
        return httpx.Response(200, json={'status': 1, 'product': {
            'product_name': 'Protein pudding',
            'brands': 'Test brand',
            'nutriments': {
                'energy-kcal_100g': 92,
                'proteins_100g': 10,
                'fat_100g': 1.5,
                'carbohydrates_100g': 8,
                'sugars_100g': 4,
            },
        }})
    monkeypatch.setattr(server.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    data = client.get('/api/food/barcode/3800014268048').json()
    assert data['food_name'] == 'Test brand · Protein pudding'
    assert data['calories'] == 92 and data['protein'] == 10
    assert data['fiber'] is None and data['missing'] == ['fiber']
    assert 'fields=' in seen['url'] and seen['agent'].startswith('FitTrack/')
    assert server.records('food') == []


@pytest.mark.parametrize('barcode', ['abc', '1234567', '123456789012345'])
def test_barcode_validation(client, monkeypatch, barcode):
    monkeypatch.setattr(server.httpx, 'AsyncClient', lambda **_: pytest.fail('Invalid barcode must not reach provider'))
    assert client.get('/api/food/barcode/' + barcode).status_code == 422


def test_barcode_not_found_and_incomplete(client, monkeypatch):
    original = httpx.AsyncClient
    replies = iter([
        {'status': 0},
        {'status': 1, 'product': {'product_name': 'Unknown', 'nutriments': {'energy-kcal_100g': 100}}},
    ])
    def handler(_):
        return httpx.Response(200, json=next(replies))
    monkeypatch.setattr(server.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handler), **kwargs))
    assert client.get('/api/food/barcode/12345678').status_code == 404
    assert client.get('/api/food/barcode/12345678').status_code == 422
