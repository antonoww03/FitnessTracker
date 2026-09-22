"""Programs, recipes, body measurements, day plans and recovery codes."""
from datetime import date as Date, timedelta
from typing import Literal
import hashlib
import json
import secrets
import sqlite3
import time
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import Field
from backend import server as s

router = APIRouter()

class PlannedExercise(s.Model):
    name: str = Field(min_length=1,max_length=120)
    sets: int = Field(ge=1,le=30)
    reps: int = Field(ge=1,le=1000)
    weight_kg: float = Field(ge=0,le=1000)
    rest_seconds: int = Field(default=90,ge=0,le=1800)

class Program(s.Model):
    name: str = Field(min_length=1,max_length=100)
    weekdays: list[int] = Field(default_factory=list,max_length=7)
    exercises: list[PlannedExercise] = Field(min_length=1,max_length=50)
    @s.field_validator('weekdays')
    @classmethod
    def days(cls,values):
        if any(v<0 or v>6 for v in values): raise ValueError('Weekdays must be 0–6')
        return sorted(set(values))

class Nutrients(s.Model):
    calories: s.NonNegative
    protein: s.NonNegative
    fat: s.NonNegative
    carbs: s.NonNegative
    sugar: s.NonNegative
    fiber: s.NonNegative

class Ingredient(s.Model):
    name: str = Field(min_length=1,max_length=120)
    grams: float = Field(gt=0,le=10000)
    per100: Nutrients

class Recipe(s.Model):
    name: str = Field(min_length=1,max_length=100)
    portions: float = Field(gt=0,le=1000)
    ingredients: list[Ingredient] = Field(min_length=1,max_length=100)

class Measurements(s.Dated):
    waist_cm: float | None = Field(default=None,gt=0,le=400)
    chest_cm: float | None = Field(default=None,gt=0,le=400)
    arm_cm: float | None = Field(default=None,gt=0,le=200)
    thigh_cm: float | None = Field(default=None,gt=0,le=250)

class DayGoals(s.Model):
    training: s.Goals
    rest: s.Goals

class DayPlan(s.Dated):
    day_type: Literal['training','rest']
    program_id: str | None = Field(default=None,max_length=100)

class RecipeLog(s.Dated):
    portions: float = Field(gt=0,le=1000)

class RecoveryRequest(s.Model):
    password: str = Field(min_length=12,max_length=128)
    model_config = s.ConfigDict(extra='forbid', str_strip_whitespace=False)

class ResetPassword(s.Model):
    username: str = Field(pattern=r'^[A-Za-z0-9_.-]{3,40}$')
    recovery_code: str = Field(min_length=20,max_length=200)
    password: str = Field(min_length=12,max_length=128)
    model_config = s.ConfigDict(extra='forbid', str_strip_whitespace=False)


def recovery_schema(db):
    db.execute('CREATE TABLE IF NOT EXISTS recovery (user_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL)')


def issue_recovery(user_id):
    code=secrets.token_urlsafe(32)
    with s.database() as db:
        recovery_schema(db)
        db.execute('INSERT INTO recovery VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET code_hash=excluded.code_hash',(user_id,s.session_hash(code)))
    return code


@router.post('/auth/recovery-code')
def recovery_code(body: RecoveryRequest, request: Request):
    s.auth_attempt(request, s.CURRENT_USER.get())
    with s.database() as db:
        user=db.execute('SELECT salt,password FROM users WHERE id=?',(s.CURRENT_USER.get(),)).fetchone()
    if not user or not secrets.compare_digest(s.password_hash(body.password,user[0]),user[1]):
        raise HTTPException(403,'Incorrect password')
    return {'recovery_code':issue_recovery(s.CURRENT_USER.get())}


@router.post('/auth/reset-password')
def reset_password(body: ResetPassword,request: Request):
    s.auth_attempt(request,body.username.lower())
    salt=secrets.token_hex(16)
    password=s.password_hash(body.password,salt)
    with s.database() as db:
        recovery_schema(db)
        user=db.execute('SELECT id FROM users WHERE username=?',(body.username.lower(),)).fetchone()
        row=db.execute('SELECT code_hash FROM recovery WHERE user_id=?',(user[0] if user else '',)).fetchone()
        if not row or not secrets.compare_digest(row[0],s.session_hash(body.recovery_code.strip())):
            raise HTTPException(400,'Invalid recovery code or username')
        db.execute('UPDATE users SET salt=?,password=? WHERE id=?',(salt,password,user[0]))
        db.execute('DELETE FROM recovery WHERE user_id=?',(user[0],))
        db.execute('DELETE FROM sessions WHERE user_id=?',(user[0],))
    return {'ok':True}


def find(kind,identifier):
    row=next((r for r in s.records(kind) if r['id']==identifier),None)
    if not row: raise HTTPException(404,'Entry not found')
    return row


@router.get('/programs')
def programs(): return s.records('program')

@router.post('/programs')
def create_program(body: Program): return s.save('program',body.model_dump())

@router.put('/programs/{identifier}')
def update_program(identifier: str,body: Program):
    find('program',identifier)
    return s.save('program',{**body.model_dump(),'id':identifier})

@router.delete('/programs/{identifier}')
def delete_program(identifier: str): return s.remove('program',identifier)

@router.get('/recipes')
def recipes(): return [recipe_values(r) for r in s.records('recipe')]

@router.post('/recipes')
def create_recipe(body: Recipe): return recipe_values(s.save('recipe',body.model_dump()))

@router.put('/recipes/{identifier}')
def edit_recipe(identifier: str,body: Recipe):
    find('recipe',identifier)
    return recipe_values(s.save('recipe',{**body.model_dump(),'id':identifier}))

@router.delete('/recipes/{identifier}')
def delete_recipe(identifier: str): return s.remove('recipe',identifier)

def recipe_values(row):
    totals={k:round(sum(i['per100'][k]*i['grams']/100 for i in row['ingredients']),3) for k in s.MACROS}
    return {**row,'totals':totals,'per_portion':{k:round(v/row['portions'],3) for k,v in totals.items()}}

@router.post('/recipes/{identifier}/log')
def log_recipe(identifier: str,body: RecipeLog):
    row=recipe_values(find('recipe',identifier))
    ratio=body.portions/row['portions']
    return s.save('food',{'date':body.date,'food_name':row['name'],'food_description':f"{body.portions:g} portions · {row['name']}",'grams':sum(i['grams'] for i in row['ingredients'])*ratio,**{k:round(v*ratio,3) for k,v in row['totals'].items()}})

@router.get('/measurements')
def measurements(): return s.records('measurements')

@router.post('/measurements')
def set_measurements(body: Measurements):
    if all(getattr(body,k) is None for k in ('waist_cm','chest_cm','arm_cm','thigh_cm')):
        raise HTTPException(422,'Enter at least one measurement')
    return s.save('measurements',body.model_dump(),body.date)

@router.delete('/measurements/{day}')
def delete_measurements(day: Date): return s.remove('measurements',str(day))

@router.get('/day-goals')
def day_goals():
    rows=s.records('day_goals')
    return {k:rows[0][k] for k in ('training','rest')} if rows else {'training':s.get_goals(),'rest':s.get_goals()}

@router.put('/day-goals')
def update_day_goals(body: DayGoals):
    s.save('day_goals',body.model_dump(),'settings')
    return body

@router.put('/plan')
def set_plan(body: DayPlan):
    if body.program_id: find('program',body.program_id)
    if body.day_type=='rest' and body.program_id: raise HTTPException(422,'A rest day cannot have a program')
    return s.save('day_plan',body.model_dump(),body.date)

@router.get('/plan')
def plan(date: Date):
    explicit=s.records('day_plan',date)
    program=None
    if explicit:
        day_type=explicit[0]['day_type']
        program=next((p for p in programs() if p['id']==explicit[0].get('program_id')),None)
    else:
        program=next((p for p in programs() if date.weekday() in p['weekdays']),None)
        day_type='training' if program else 'rest'
    return {'date':str(date),'day_type':day_type,'program':program,'goals':day_goals()[day_type]}

@router.get('/personal-records')
def personal_records():
    result={}
    for training in s.records('training'):
        sets=training.get('sets_log',[])
        if not sets:
            sets=[{'name':e['name'],'reps':e['reps'],'weight_kg':e['weight_kg']} for e in training.get('exercises',[]) for _ in range(e['sets'])]
        for row in reversed(sets):
            if row.get("warmup"): continue
            key=row['name'].strip().casefold()
            item=result.setdefault(key,{'name':row['name'],'max_weight_kg':0,'max_reps':0,'total_volume_kg':0,'total_sets':0,'last_date':training['date'],'last_set':row})
            item['max_weight_kg']=max(item['max_weight_kg'],row['weight_kg'])
            item['max_reps']=max(item['max_reps'],row['reps'])
            item['total_volume_kg']+=row['weight_kg']*row['reps']
            item['total_sets']+=1
    return sorted(result.values(),key=lambda r:r['name'].casefold())

ADVANCED_MODELS={'program':Program,'recipe':Recipe,'measurements':Measurements,'day_goals':DayGoals,'day_plan':DayPlan,'favorite_food':s.FoodLogCreate}

class PasswordChange(RecoveryRequest):
    new_password: str = Field(min_length=12, max_length=128)

class AccountDeletion(RecoveryRequest):
    confirm_username: str


def verify_password(body, request, db):
    s.auth_attempt(request, s.CURRENT_USER.get())
    row=db.execute('SELECT username,salt,password FROM users WHERE id=?',(s.CURRENT_USER.get(),)).fetchone()
    if not row or not secrets.compare_digest(s.password_hash(body.password,row[1]),row[2]):
        raise HTTPException(403,'Incorrect password')
    return row


@router.post('/auth/change-password')
def change_password(body: PasswordChange, request: Request, response: Response):
    with s.database() as db:
        verify_password(body,request,db)
        salt=secrets.token_hex(16)
        db.execute('UPDATE users SET salt=?,password=? WHERE id=?',(salt,s.password_hash(body.new_password,salt),s.CURRENT_USER.get()))
        db.execute('DELETE FROM sessions WHERE user_id=?',(s.CURRENT_USER.get(),))
        recovery_schema(db)
        db.execute('DELETE FROM recovery WHERE user_id=?',(s.CURRENT_USER.get(),))
    response.delete_cookie('fittrack_session',path='/api')
    return {'ok':True}


@router.post('/auth/logout-all')
def logout_all(body: RecoveryRequest,request: Request,response: Response):
    with s.database() as db:
        verify_password(body,request,db)
        subscriptions=db.execute('SELECT id FROM records WHERE kind=?',(s.scoped('push_subscription'),)).fetchall()
        db.executemany('DELETE FROM push_deliveries WHERE subscription_id=?',subscriptions)
        db.execute('DELETE FROM records WHERE kind=?',(s.scoped('push_subscription'),))
        db.execute('DELETE FROM sessions WHERE user_id=?',(s.CURRENT_USER.get(),))
    response.delete_cookie('fittrack_session',path='/api')
    return {'ok':True}


@router.delete('/auth/account')
def delete_account(body: AccountDeletion,request: Request,response: Response):
    owner=s.CURRENT_USER.get()
    with s.database() as db:
        account=verify_password(body,request,db)
        if body.confirm_username != account[0]: raise HTTPException(422,'Type your username to confirm')
        # Match the exact UUID prefix; never interpolate a LIKE pattern from a username.
        subscriptions=db.execute('SELECT id FROM records WHERE kind=?',(s.scoped('push_subscription'),)).fetchall()
        db.executemany('DELETE FROM push_deliveries WHERE subscription_id=?',subscriptions)
        db.execute('DELETE FROM records WHERE substr(kind,1,?)=?',(len(owner)+1,owner+':'))
        db.execute('DELETE FROM sessions WHERE user_id=?',(owner,))
        db.execute('DELETE FROM operations WHERE owner=?',(owner,))
        recovery_schema(db)
        db.execute('DELETE FROM recovery WHERE user_id=?',(owner,))
        db.execute('DELETE FROM users WHERE id=?',(owner,))
    response.delete_cookie('fittrack_session',path='/api')
    return {'ok':True}


@router.get('/favorite-foods')
def favorite_foods(): return s.records('favorite_food')

@router.post('/favorite-foods')
def favorite_food(body:s.FoodLogCreate): return s.save('favorite_food',body.model_dump())

@router.delete('/favorite-foods/{identifier}')
def remove_favorite(identifier:str): return s.remove('favorite_food',identifier)

@router.get('/recent-foods')
def recent_foods():
    found={}
    for row in s.records('food'):
        key=row['food_name'].strip().casefold()
        if key not in found: found[key]=row
        if len(found)==20: break
    return list(found.values())

class CopyFood(s.Dated):
    meal_type: Literal['breakfast','lunch','dinner','snack'] = 'snack'

@router.post('/food/{identifier}/copy')
def copy_food(identifier:str,body:CopyFood):
    source=find('food',identifier)
    data={k:source[k] for k in s.FoodLogCreate.model_fields if k in source}
    return s.save('food',s.FoodLogCreate.model_validate({**data,**body.model_dump()}).model_dump())


def working_sets(row):
    sets=row.get('sets_log') or [dict(name=e['name'],reps=e['reps'],weight_kg=e['weight_kg']) for e in row.get('exercises',[]) for _ in range(e['sets'])]
    return [e for e in sets if not e.get('warmup')]

@router.get('/exercise-progress')
def exercise_progress(start:Date,end:Date):
    if end<start or (end-start).days>366: raise HTTPException(422,'Choose a range of up to 367 days')
    result={}
    for row in reversed(s.records('training')):
        if not str(start)<=row['date']<=str(end): continue
        for e in working_sets(row):
            key=(e['name'].strip().casefold(),row['date'])
            item=result.setdefault(key,dict(name=e['name'],date=row['date'],max_weight_kg=0,max_reps=0,volume_kg=0,sets=0))
            item['max_weight_kg']=max(item['max_weight_kg'],e['weight_kg'])
            item['max_reps']=max(item['max_reps'],e['reps'])
            item['volume_kg']+=e['weight_kg']*e['reps'];item['sets']+=1
    return sorted(result.values(),key=lambda r:(r['date'],r['name'].casefold()))

@router.get('/training-calendar')
def training_calendar(start:Date,end:Date):
    if end<start or (end-start).days>61: raise HTTPException(422,'Choose up to 62 days')
    programs_by_id={p['id']:p for p in programs()}
    explicit={r['date']:r for r in s.records('day_plan')}
    logs=s.records('training')
    days=[]
    for offset in range((end-start).days+1):
        date=start+timedelta(days=offset);day=str(date);entry=explicit.get(day)
        program=programs_by_id.get(entry.get('program_id')) if entry else next((p for p in programs_by_id.values() if date.weekday() in p['weekdays']),None)
        completed=[r for r in logs if r['date']==day]
        days.append(dict(date=day,day_type=entry['day_type'] if entry else 'training' if program else 'rest',program=program,completed=len(completed),minutes=sum(r['duration_minutes'] for r in completed),volume_kg=sum(e['weight_kg']*e['reps'] for r in completed for e in working_sets(r))))
    return days
