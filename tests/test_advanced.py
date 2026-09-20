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
