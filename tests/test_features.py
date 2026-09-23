import json
import sqlite3
import stat
import pytest
from fastapi.testclient import TestClient
from backend import server
from backend.maintenance import backup_database, generate_vapid_keys, migrate_legacy

DAY='2026-09-17'
FOOD=dict(date=DAY,food_name='Rice',food_description='100 g rice',grams=100,calories=130,protein=3,fat=1,carbs=28,sugar=0,fiber=1)

@pytest.fixture
def clients(tmp_path,monkeypatch):
    monkeypatch.setenv('FITTRACK_AUTO_BACKUP','0')
    monkeypatch.setattr(server,'DB_PATH',tmp_path/'data.db')
    monkeypatch.delenv('FITTRACK_AUTH_DISABLED',raising=False)
    with TestClient(server.app,base_url='https://testserver') as a, TestClient(server.app,base_url='https://testserver') as b:
        for c,name in [(a,'alice'),(b,'bob')]:
            c.headers['X-Requested-With']='FitTrack'
            r=c.post('/api/auth/register',json={'username':name,'password':'a-unique-password-123'})
            assert r.status_code==200
            assert 'HttpOnly' in r.headers['set-cookie'] and 'Secure' in r.headers['set-cookie']
        yield a,b


def test_auth_isolation_and_csrf(clients):
    a,b=clients
    row=a.post('/api/food',json=FOOD).json()
    assert b.get(f'/api/food?date={DAY}').json()==[]
    assert b.put('/api/entries/food/'+row['id'],json=FOOD).status_code==404
    assert b.delete('/api/entries/food/'+row['id']).status_code==404
    assert b.get('/api/backup').json()['records']['food']==[]
    assert a.post('/api/water',json={'date':DAY,'amount_ml':250},headers={'Origin':'https://evil.invalid'}).status_code==403
    a.headers.pop('X-Requested-With')
    assert a.post('/api/water',json={'date':DAY,'amount_ml':250}).status_code==403
    a.headers['X-Requested-With']='FitTrack'
    assert a.post('/api/auth/logout').status_code==200
    assert a.get(f'/api/summary?date={DAY}').status_code==401
    assert a.post('/api/auth/login',json={'username':'alice','password':'wrong-password-123'}).status_code==401
    assert a.post('/api/auth/login',json={'username':'alice','password':'a-unique-password-123'}).status_code==200
    assert a.get(f'/api/food?date={DAY}').json()[0]['id']==row['id']


def test_edit_live_reports_undo_conflict(clients):
    a,b=clients
    row=a.post('/api/food',json=FOOD).json()
    assert a.put('/api/entries/food/'+row['id'],json={**FOOD,'calories':200}).status_code==200
    assert a.get('/api/reports').json()[0]['totals']['calories']==200
    token=a.delete('/api/entries/food/'+row['id']).json()['undo_token']
    assert b.post('/api/undo/'+token).status_code==404
    assert a.get('/api/reports').json()==[]
    assert a.post('/api/undo/'+token).status_code==200
    assert a.post('/api/undo/'+token).status_code==404
    a.post('/api/weight',json={'date':DAY,'weight_kg':74})
    token=a.delete('/api/entries/weight/'+DAY).json()['undo_token']
    a.post('/api/weight',json={'date':DAY,'weight_kg':75})
    assert a.post('/api/undo/'+token).status_code==409
    assert a.get('/api/weight?date='+DAY).json()['weight_kg']==75


def test_meals_copy_exercises_history(clients):
    a,b=clients
    a.post('/api/food',json=FOOD)
    exercise={'name':'Squat','sets':3,'reps':8,'weight_kg':60}
    training={'date':DAY,'training_type':'Strength','duration_minutes':45,'exercises':[exercise]}
    row=a.post('/api/training',json=training).json()
    assert row['exercises']==[exercise]
    assert a.post('/api/training',json={**training,'exercises':[{**exercise,'sets':0}]}).status_code==422
    meal=a.post('/api/meals',json={'name':'Lunch','foods':[FOOD]}).json()
    assert b.post('/api/meals/'+meal['id']+'/log?date='+DAY).status_code==404
    assert a.post('/api/meals/'+meal['id']+'/log?date=2026-09-18').json()['logged']==1
    assert a.post('/api/copy-day',json={'source':DAY,'target':'2026-09-19'}).json()['copied']==2
    assert len(a.get('/api/history?start=2026-09-17&end=2026-09-19&kind=food').json())==3
    assert a.get('/api/history?start=2020-01-01&end=2026-09-19').status_code==422
    assert a.post('/api/copy-day',json={'source':DAY,'target':DAY}).status_code==422


def test_weight_rolling_average_and_preferences(clients):
    a,b=clients
    for date,weight in [('2026-09-01',80),('2026-09-14',74),('2026-09-17',72)]:
        a.post('/api/weight',json={'date':date,'weight_kg':weight})
    row=a.get('/api/progress?start=2026-09-17&end=2026-09-17').json()[0]
    assert row['weight_average_7d']==73 and row['weight_samples_7d']==2
    prefs={'water_goal_ml':3500,'language':'bg','theme':'light','hidden_sections':[]}
    assert a.put('/api/preferences',json=prefs).json()==prefs
    assert b.get('/api/preferences').json()['water_goal_ml']==3000
    assert a.put('/api/preferences',json={**prefs,'water_goal_ml':0}).status_code==422


def test_backup_restore_atomic_validated_scoped(clients,tmp_path):
    a,b=clients
    a.post('/api/food',json=FOOD)
    backup=a.get('/api/backup').json()
    assert 'password' not in json.dumps(backup)
    invalid=json.loads(json.dumps(backup));invalid['records']['food'].append({**FOOD,'calories':-10})
    assert b.post('/api/backup/restore',json=invalid).status_code==422
    assert b.get('/api/food?date='+DAY).json()==[]
    assert b.post('/api/backup/restore',json=backup).status_code==200
    assert b.post('/api/backup/restore',json=backup).status_code==200
    assert len(b.get('/api/food?date='+DAY).json())==1
    if server.storage.postgres_enabled():
        with pytest.raises(ValueError, match='pg_dump'):
            backup_database(tmp_path/'backup.db')
        return
    destination=backup_database(tmp_path/'backup.db')
    with sqlite3.connect(destination) as db:
        assert db.execute('SELECT count(*) FROM users').fetchone()[0]==2
    assert destination.stat().st_mode & 0o777==0o600


def test_legacy_never_claimed_on_registration(clients):
    a,b=clients
    server.save('food',FOOD)
    assert a.get('/api/food?date='+DAY).json()==[]
    assert migrate_legacy('alice')==1
    assert len(a.get('/api/food?date='+DAY).json())==1
    assert b.get('/api/food?date='+DAY).json()==[]


def test_vapid_key_generation():
    import base64
    keys=generate_vapid_keys()
    decode=lambda value: base64.urlsafe_b64decode(value+'='*((4-len(value)%4)%4))
    assert len(decode(keys['VAPID_PRIVATE_KEY']))==32
    assert len(decode(keys['VAPID_PUBLIC_KEY']))==65


def test_automatic_vapid_key_is_private_and_stable(tmp_path, monkeypatch):
    target = tmp_path / 'private' / 'vapid.json'
    for name in ('VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('FITTRACK_AUTO_VAPID', '1')
    monkeypatch.setenv('FITTRACK_VAPID_KEY_FILE', str(target))
    monkeypatch.setenv('FITTRACK_VAPID_SUBJECT', 'https://example.com/contact')
    first = server.vapid_configuration()
    second = server.vapid_configuration()
    assert first == second
    assert first['subject'] == 'https://example.com/contact'
    if server.storage.postgres_enabled():
        assert not target.exists()
        return
    assert target.is_file()
    assert stat.S_IMODE(target.stat().st_mode) == 0o600


def test_login_rate_limit(clients):
    a,_=clients
    codes=[a.post('/api/auth/login',json={'username':'nobody','password':'wrong-password-123'}).status_code for _ in range(21)]
    assert codes[-1]==429


def test_restore_rejects_non_object_entries(clients):
    a,_=clients
    assert a.post('/api/backup/restore',json={'version':1,'records':{'food':[1]}}).status_code==422


def test_automatic_backup_startup(tmp_path,monkeypatch):
    import time
    if server.storage.postgres_enabled():
        with TestClient(server.app):
            assert server.app.state.backup_task is None
        return
    monkeypatch.setattr(server,'DB_PATH',tmp_path/'source.db')
    monkeypatch.setenv('FITTRACK_AUTO_BACKUP','1')
    monkeypatch.setenv('FITTRACK_BACKUP_DIR',str(tmp_path/'snapshots'))
    with TestClient(server.app):
        deadline=time.monotonic()+3
        while time.monotonic()<deadline:
            snapshots=list((tmp_path/'snapshots').glob('*.sqlite3'))
            if snapshots:
                with sqlite3.connect(snapshots[0]) as db:
                    if db.execute("SELECT name FROM sqlite_master WHERE name='users'").fetchone():
                        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
                        break
            time.sleep(.02)
        else:
            pytest.fail('Automatic backup was not created')
