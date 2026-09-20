import pytest
from tests.test_features import clients, FOOD, DAY
from backend import server

PROGRAM={'name':'Back · Shoulders · Biceps','weekdays':[3], 'exercises':[{'name':'Row','sets':3,'reps':10,'weight_kg':50,'rest_seconds':90}]}
RECIPE={'name':'Rice bowl','portions':2,'ingredients':[{'name':'Rice','grams':200,'per100':{'calories':130,'protein':3,'fat':1,'carbs':28,'sugar':0,'fiber':1}}]}


def test_program_plan_goals_isolated(clients):
    a,b=clients
    program=a.post('/api/programs',json=PROGRAM).json()
    assert b.get('/api/programs').json()==[]
    assert b.put('/api/programs/'+program['id'],json=PROGRAM).status_code==404
    assert a.get('/api/plan?date='+DAY).json()['program']['id']==program['id']
    targets={'training':{**server.DEFAULT_GOALS,'calories':3000},'rest':{**server.DEFAULT_GOALS,'calories':2200}}
    assert a.put('/api/day-goals',json=targets).status_code==200
    assert a.get('/api/summary?date='+DAY).json()['goals']['calories']==3000
    assert a.put('/api/plan',json={'date':DAY,'day_type':'rest'}).status_code==200
    assert a.get('/api/summary?date='+DAY).json()['goals']['calories']==2200
    assert a.put('/api/goals?date='+DAY,json={**server.DEFAULT_GOALS,'calories':2300}).status_code==200
    assert a.get('/api/day-goals').json()['rest']['calories']==2300
    assert a.get('/api/day-goals').json()['training']['calories']==3000
    assert a.post('/api/programs',json={**PROGRAM,'weekdays':[7]}).status_code==422


def test_recipe_scale_and_validation(clients):
    a,b=clients
    recipe=a.post('/api/recipes',json=RECIPE).json()
    assert recipe['per_portion']['calories']==130
    assert b.post('/api/recipes/'+recipe['id']+'/log',json={'date':DAY,'portions':1}).status_code==404
    row=a.post('/api/recipes/'+recipe['id']+'/log',json={'date':DAY,'portions':1.5}).json()
    assert row['calories']==195 and row['grams']==150
    assert a.post('/api/recipes',json={**RECIPE,'portions':0}).status_code==422
    assert a.post('/api/recipes',json={**RECIPE,'ingredients':[{'name':'rice','grams':100,'per100':{'calories':100}}]}).status_code==422


def test_completed_sets_records_and_measurements(clients):
    a,b=clients
    body={'date':DAY,'training_type':'Strength','duration_minutes':30,'sets_log':[{'name':'Row','reps':10,'weight_kg':50},{'name':'Row','reps':8,'weight_kg':60}]}
    assert a.post('/api/training',json=body).status_code==200
    rec=a.get('/api/personal-records').json()[0]
    assert rec['max_weight_kg']==60 and rec['max_reps']==10 and rec['total_volume_kg']==980 and rec['total_sets']==2
    assert b.get('/api/personal-records').json()==[]
    assert a.post('/api/measurements',json={'date':DAY,'waist_cm':80}).status_code==200
    assert a.post('/api/measurements',json={'date':DAY,'waist_cm':79}).status_code==200
    assert len(a.get('/api/measurements').json())==1
    assert b.get('/api/measurements').json()==[]
    assert a.post('/api/measurements',json={'date':DAY}).status_code==422
    assert a.post('/api/measurements',json={'date':DAY,'arm_cm':-1}).status_code==422


def test_recovery_consumed_revokes_sessions(clients):
    a,b=clients
    assert a.post('/api/auth/recovery-code',json={'password':'wrong-password-123'}).status_code==403
    code=a.post('/api/auth/recovery-code',json={'password':'a-unique-password-123'}).json()['recovery_code']
    assert b.post('/api/auth/reset-password',json={'username':'bob','password':'new-password-for-alice','recovery_code':code}).status_code==400
    assert b.post('/api/auth/reset-password',json={'username':'alice','password':'new-password-for-alice','recovery_code':code}).status_code==200
    assert a.get('/api/auth/me').status_code==401
    assert a.post('/api/auth/reset-password',json={'username':'alice','password':'another-password-123','recovery_code':code}).status_code==400
    assert a.post('/api/auth/login',json={'username':'alice','password':'new-password-for-alice'}).status_code==200
    assert 'recovery_code' not in a.get('/api/backup').text


def test_retry_idempotent_owner_scoped(clients):
    a,b=clients
    headers={'X-Operation-ID':'offline-operation-1234'}
    first=a.post('/api/food',json=FOOD,headers=headers)
    assert first.status_code==200
    assert a.post('/api/food',json=FOOD,headers=headers).json()==first.json()
    assert len(a.get('/api/food?date='+DAY).json())==1
    assert a.post('/api/food',json={**FOOD,'calories':777},headers=headers).status_code==409
    assert b.post('/api/food',json=FOOD,headers=headers).status_code==200
    assert a.post('/api/water',json={'date':DAY,'amount_ml':250},headers={'X-Operation-ID':'bad'}).status_code==422


def test_backup_new_collections_round_trip(clients):
    a,b=clients
    a.post('/api/programs',json=PROGRAM)
    a.post('/api/recipes',json=RECIPE)
    a.post('/api/measurements',json={'date':DAY,'waist_cm':80})
    data=a.get('/api/backup').json()
    assert b.post('/api/backup/restore',json=data).status_code==200
    assert b.get('/api/programs').json()[0]['name']==PROGRAM['name']
    assert b.get('/api/recipes').json()[0]['per_portion']['calories']==130
    assert b.get('/api/measurements').json()[0]['waist_cm']==80


def test_password_change_and_all_sessions(clients):
    a,b=clients
    other_token=a.cookies.get('fittrack_session')
    assert a.post('/api/auth/change-password',json={'password':'wrong-password-123','new_password':'a-new-password-123'}).status_code==403
    assert a.post('/api/auth/change-password',json={'password':'a-unique-password-123','new_password':'a-new-password-123'}).status_code==200
    assert a.get('/api/auth/me').status_code==401
    assert a.post('/api/auth/login',json={'username':'alice','password':'a-unique-password-123'}).status_code==401
    assert a.post('/api/auth/login',json={'username':'alice','password':'a-new-password-123'}).status_code==200
    assert a.post('/api/auth/logout-all',json={'password':'a-new-password-123'}).status_code==200
    assert a.get('/api/auth/me').status_code==401
    assert b.get('/api/auth/me').status_code==200


def test_account_deletion_scoped_and_confirmed(clients):
    a,b=clients
    alice=a.get('/api/auth/me').json()['id']
    a.post('/api/food',json=FOOD,headers={'X-Operation-ID':'account-delete-op-123'})
    b.post('/api/food',json=FOOD)
    assert a.request('DELETE','/api/auth/account',json={'password':'a-unique-password-123','confirm_username':'bob'}).status_code==422
    assert a.request('DELETE','/api/auth/account',json={'password':'a-unique-password-123','confirm_username':'alice'}).status_code==200
    assert a.get('/api/auth/me').status_code==401
    assert len(b.get('/api/food?date='+DAY).json())==1
    with server.database() as db:
        assert db.execute('SELECT count(*) FROM records WHERE substr(kind,1,?)=?',(len(alice)+1,alice+':')).fetchone()[0]==0
        for table,key in [('users','id'),('sessions','user_id'),('operations','owner'),('recovery','user_id')]:
            assert db.execute(f'SELECT count(*) FROM {table} WHERE {key}=?',(alice,)).fetchone()[0]==0


def test_favorites_recent_copy_and_backup(clients):
    a,b=clients
    row=a.post('/api/food',json={**FOOD,'meal_type':'lunch'}).json()
    a.post('/api/food',json={**FOOD,'date':'2026-09-18'})
    assert len(a.get('/api/recent-foods').json())==1
    favorite=a.post('/api/favorite-foods',json=FOOD).json()
    assert b.get('/api/favorite-foods').json()==[]
    assert b.delete('/api/favorite-foods/'+favorite['id']).status_code==404
    assert b.post('/api/food/'+row['id']+'/copy',json={'date':DAY}).status_code==404
    copied=a.post('/api/food/'+row['id']+'/copy',json={'date':'2026-09-19','meal_type':'dinner'}).json()
    assert copied['meal_type']=='dinner' and copied['calories']==FOOD['calories'] and copied['id']!=row['id']
    assert a.post('/api/food',json={**FOOD,'meal_type':'unknown'}).status_code==422
    backup=a.get('/api/backup').json()
    assert b.post('/api/backup/restore',json=backup).status_code==200
    assert b.get('/api/favorite-foods').json()[0]['food_name']=='Rice'


def test_working_sets_progress_and_calendar(clients):
    a,b=clients
    program=a.post('/api/programs',json=PROGRAM).json()
    body={'date':DAY,'training_type':'Strength','duration_minutes':30,'sets_log':[{'name':'Row','reps':20,'weight_kg':100,'warmup':True,'notes':'warm up'},{'name':'Row','reps':8,'weight_kg':60,'superset':'A','notes':'controlled'}]}
    row=a.post('/api/training',json=body).json()
    assert row['sets_log'][1]['notes']=='controlled'
    rec=a.get('/api/personal-records').json()[0]
    assert rec['max_weight_kg']==60 and rec['total_volume_kg']==480
    progress=a.get('/api/exercise-progress?start='+DAY+'&end='+DAY).json()
    assert progress[0]['volume_kg']==480 and progress[0]['sets']==1
    assert b.get('/api/exercise-progress?start='+DAY+'&end='+DAY).json()==[]
    calendar=a.get('/api/training-calendar?start='+DAY+'&end='+DAY).json()[0]
    assert calendar['completed']==1 and calendar['program']['id']==program['id'] and calendar['volume_kg']==480
    assert a.get('/api/training-calendar?start=2025-01-01&end='+DAY).status_code==422
    assert a.put('/api/preferences',json={'hidden_sections':['water','activity']}).status_code==200
    assert a.get('/api/preferences').json()['hidden_sections']==['water','activity']
    assert b.get('/api/preferences').json()['hidden_sections']==[]


def test_legacy_preferences_upgrade(clients):
    a,b=clients
    owner=a.get('/api/auth/me').json()['id']
    import json
    with server.database() as db:
        db.execute('INSERT INTO records VALUES (?,?,?,?)',(owner+':preferences','settings','',json.dumps({'water_goal_ml':3200,'language':'bg','theme':'light'})))
    assert a.get('/api/preferences').json()['hidden_sections']==[]


def test_password_spaces_are_significant(clients):
    a,b=clients
    spaced='  a-unique-password-123  '
    assert a.post('/api/auth/change-password',json={'password':'a-unique-password-123','new_password':spaced}).status_code==200
    assert a.post('/api/auth/login',json={'username':'alice','password':spaced.strip()}).status_code==401
    assert a.post('/api/auth/login',json={'username':'alice','password':spaced}).status_code==200
    assert a.post('/api/auth/recovery-code',json={'password':spaced}).status_code==200
