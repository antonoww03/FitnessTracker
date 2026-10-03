import pytest
from tests.test_features import clients, DAY, FOOD

CASES = [('food', FOOD), ('water', {'date':DAY,'amount_ml':250}), ('weight', {'date':DAY,'weight_kg':74}), ('training', {'date':DAY,'training_type':'Strength','duration_minutes':45,'exercises':[]})]

@pytest.mark.parametrize('kind,payload', CASES)
@pytest.mark.parametrize('paged', [False, True])
@pytest.mark.parametrize('header', ['If-Match', 'X-FitTrack-Revision'])
def test_fresh_history_delete(clients, kind, payload, paged, header):
    a,b = clients
    assert a.post('/api/'+kind, json=payload).status_code == 200
    params = {'start':DAY,'end':DAY, **({'limit':100,'offset':0} if paged else {})}
    row = a.get('/api/history',params=params).json()[0]
    url = '/api/entries/'+kind+'/'+row['id']
    assert row['_revision_header'] == 'X-FitTrack-Revision'
    headers = {header:row['_revision']}
    assert b.delete(url,headers=headers).status_code == 409
    result = a.delete(url,headers=headers)
    assert result.status_code == 200, result.text
    assert a.get('/api/history',params=params).json() == []


def test_header_migration_preserves_replay_and_conflicts(clients):
    a,_ = clients
    assert a.get('/api').json()['entry_revision_header'] == 'X-FitTrack-Revision'
    a.post('/api/water', json={'date':DAY,'amount_ml':250})
    row = a.get('/api/history', params={'start':DAY,'end':DAY}).json()[0]
    url = '/api/entries/water/'+row['id']
    revision = row['_revision']
    edit = a.put(url, json={'date':DAY,'amount_ml':500}, headers={'X-FitTrack-Revision':revision})
    assert edit.status_code == 200
    assert a.delete(url, headers={'X-FitTrack-Revision':revision}).status_code == 409
    current = edit.json()['_revision']
    assert a.delete(url, headers={'X-FitTrack-Revision':current,'If-Match':revision}).status_code == 422
    assert a.delete(url, headers={'X-FitTrack-Revision':'invalid'}).status_code == 422
    operation = {'X-Operation-ID':'fit55-lost-response-delete'}
    deleted = a.delete(url, headers={**operation,'If-Match':current})
    assert deleted.status_code == 200
    replay = a.delete(url, headers={**operation,'X-FitTrack-Revision':current})
    assert replay.status_code == 200
    assert replay.json() == deleted.json()
    assert a.post('/api/undo/'+replay.json()['undo_token']).status_code == 200
    assert len(a.get('/api/history', params={'start':DAY,'end':DAY}).json()) == 1
