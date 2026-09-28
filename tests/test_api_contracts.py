"""Consumer expectations: intentional API shape changes require updating callers."""
from backend import server
from tests.test_features import clients, DAY, FOOD


def test_consumer_routes_are_registered():
    paths = server.app.openapi()['paths']
    required = {'/api/profile':('get','put'), '/api/history':('get',), '/api/backup':('get',), '/api/backup/restore':('post',), '/api/auth/account':('delete',), '/api/entries/{kind}/{identifier}':('put','delete')}
    for path, methods in required.items():
        for method in methods:
            assert method in paths[path]


def test_frontend_consumed_response_shapes(clients):
    a, _ = clients
    assert {'id','username'} <= a.get('/api/auth/me').json().keys()
    assert set(a.get('/api/profile').json()) == set(server.Profile.model_fields)
    a.post('/api/food', json=FOOD)
    history = a.get('/api/history',params={'start':DAY,'end':DAY,'limit':100}).json()
    assert isinstance(history,list) and len(history)==1
    assert {'id','date','kind','_revision','food_name','calories'} <= history[0].keys()
    assert isinstance(history[0]['calories'], (int,float))
    assert history[0]['kind']=='food'
    assert len(history[0]['_revision'])==64
    archive = a.get('/api/backup').json()
    assert archive['version']==1 and isinstance(archive['records'],dict)
