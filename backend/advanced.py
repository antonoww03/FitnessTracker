"""Programs, recipes, body measurements, day plans and recovery codes."""
from datetime import date as Date, timedelta
from typing import Literal
import hashlib
import json
import secrets
import sqlite3
import time
from fastapi import APIRouter, HTTPException, Request
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
    model_config = s.ConfigDict(extra='forbid')

class ResetPassword(s.Model):
    username: str = Field(pattern=r'^[A-Za-z0-9_.-]{3,40}$')
    recovery_code: str = Field(min_length=20,max_length=200)
    password: str = Field(min_length=12,max_length=128)
    model_config = s.ConfigDict(extra='forbid')


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
            key=row['name'].strip().casefold()
            item=result.setdefault(key,{'name':row['name'],'max_weight_kg':0,'max_reps':0,'total_volume_kg':0,'total_sets':0,'last_date':training['date'],'last_set':row})
            item['max_weight_kg']=max(item['max_weight_kg'],row['weight_kg'])
            item['max_reps']=max(item['max_reps'],row['reps'])
            item['total_volume_kg']+=row['weight_kg']*row['reps']
            item['total_sets']+=1
    return sorted(result.values(),key=lambda r:r['name'].casefold())

ADVANCED_MODELS={'program':Program,'recipe':Recipe,'measurements':Measurements,'day_goals':DayGoals,'day_plan':DayPlan}
