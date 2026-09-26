from concurrent.futures import ThreadPoolExecutor
from tests.test_features import clients, DAY


def history(a):
    return a.get('/api/history',params={'start':DAY,'end':DAY}).json()


def test_conditional_edit_replay_conflict_and_delete(clients):
    a,b=clients
    a.post('/api/water',json={'date':DAY,'amount_ml':250})
    row=history(a)[0]
    url='/api/entries/water/'+row['id']
    headers={'If-Match':row['_revision'],'X-Operation-ID':'offline-edit-operation-123'}
    payload={'date':DAY,'amount_ml':500}
    first=a.put(url,json=payload,headers=headers)
    assert first.status_code==200
    assert a.put(url,json=payload,headers=headers).json()==first.json()
    assert len(history(a))==1
    assert a.put(url,json={**payload,'amount_ml':700},headers=headers).status_code==409
    stale={'If-Match':row['_revision'],'X-Operation-ID':'offline-stale-operation-123'}
    assert a.put(url,json=payload,headers=stale).status_code==409
    assert a.delete(url,headers=stale).status_code==409
    assert b.delete(url,headers=stale).status_code==409
    latest=history(a)[0]
    assert latest['amount_ml']==500 and latest['_revision']!=row['_revision']
    delete={'If-Match':latest['_revision'],'X-Operation-ID':'offline-delete-operation-123'}
    first=a.delete(url,headers=delete)
    assert first.status_code==200
    assert a.delete(url,headers=delete).json()==first.json()
    assert history(a)==[]
    assert a.post('/api/undo/'+first.json()['undo_token']).status_code==200
    assert history(a)[0]['amount_ml']==500


def test_concurrent_conditional_edits_cannot_overwrite(clients):
    a,_=clients
    a.post('/api/water',json={'date':DAY,'amount_ml':250})
    row=history(a)[0]
    def edit(i):
        return a.put('/api/entries/water/'+row['id'],json={'date':DAY,'amount_ml':500+i},
                     headers={'If-Match':row['_revision'],'X-Operation-ID':f'concurrent-edit-operation-{i}'}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(edit,range(2)))==[200,409]
