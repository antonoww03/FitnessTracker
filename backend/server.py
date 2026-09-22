"""Authenticated fitness API with durable, per-user SQLite storage."""
from contextlib import contextmanager
from datetime import date as Date, datetime, timedelta, timezone
from io import BytesIO, StringIO
from pathlib import Path
from typing import Annotated, Literal
import base64
import binascii
import csv
import json
import math
import os
import re
import sqlite3
import uuid
import hashlib
import secrets
import time
from contextvars import ContextVar

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')
DB_PATH = Path(os.getenv('FITTRACK_DB_PATH', str(ROOT_DIR / 'data' / 'fittrack.sqlite3')))
MACROS = ('calories', 'protein', 'fat', 'carbs', 'sugar', 'fiber')
DEFAULT_GOALS = dict(zip(MACROS, (2000, 150, 65, 250, 50, 30)))
app = FastAPI(title='FitTrack API')
app.add_middleware(
    CORSMiddleware,
    allow_origins=[x.strip() for x in os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000').split(',') if x.strip()],
    allow_credentials=True, allow_methods=['GET', 'POST', 'PUT', 'DELETE'],
    allow_headers=['Content-Type', 'X-Requested-With', 'X-Operation-ID'],
)
api_router = APIRouter()
CURRENT_USER = ContextVar("current_user", default="")
OPERATION_ID = ContextVar("operation_id", default=None)

def scoped(kind):
    owner = CURRENT_USER.get()
    return f"{owner}:{kind}" if owner else kind



@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=15)
    try:
        with connection:
            connection.execute('CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind, id))')
            connection.execute('CREATE INDEX IF NOT EXISTS records_date ON records(kind, date)')
            connection.execute('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL)')
            connection.execute('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires REAL NOT NULL)')
            connection.execute('CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until REAL NOT NULL)')
            connection.execute('CREATE TABLE IF NOT EXISTS operations (owner TEXT NOT NULL, op TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(owner, op))')
            yield connection
    finally:
        connection.close()


def save(kind, payload, identifier=None):
    record = dict(payload)
    record.setdefault('id', identifier or str(uuid.uuid4()))
    record.setdefault('timestamp', datetime.now(timezone.utc).isoformat())
    with database() as db:
        operation = OPERATION_ID.get() if kind in ('food','training','water','weight') else None
        digest = hashlib.sha256(json.dumps([kind,payload],sort_keys=True).encode()).hexdigest()
        if operation:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT digest,response FROM operations WHERE owner=? AND op=?',(CURRENT_USER.get(),operation)).fetchone()
            if previous:
                if previous[0] != digest: raise HTTPException(409,'Operation ID already used with different data')
                return json.loads(previous[1])
        db.execute('INSERT INTO records VALUES (?, ?, ?, ?) ON CONFLICT(kind,id) DO UPDATE SET date=excluded.date,payload=excluded.payload',
                   (scoped(kind), record['id'], record.get('date', ''), json.dumps(record, allow_nan=False)))
        if operation: db.execute('INSERT INTO operations VALUES (?,?,?,?)',(CURRENT_USER.get(),operation,digest,json.dumps(record)))
    return record


def records(kind, day=None):
    with database() as db:
        query = 'SELECT payload FROM records WHERE kind=?'
        params = [scoped(kind)]
        if day is not None:
            query += ' AND date=?'
            params.append(str(day))
        return [json.loads(row[0]) for row in db.execute(query + ' ORDER BY date DESC, rowid DESC', params)]


def remove(kind, identifier):
    with database() as db:
        result = db.execute('DELETE FROM records WHERE kind=? AND id=?', (scoped(kind), identifier))
        if not result.rowcount:
            raise HTTPException(404, 'Entry not found')
    return {'ok': True}


class Model(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, str_strip_whitespace=True, extra='forbid')


class Dated(Model):
    date: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}$')

    @field_validator('date')
    @classmethod
    def valid_date(cls, value):
        Date.fromisoformat(value)
        return value


NonNegative = Annotated[float, Field(ge=0)]
Positive = Annotated[float, Field(gt=0)]


class Goals(Model):
    calories: NonNegative = 2000
    protein: NonNegative = 150
    fat: NonNegative = 65
    carbs: NonNegative = 250
    sugar: NonNegative = 50
    fiber: NonNegative = 30


class FoodLogCreate(Dated):
    meal_type: Literal["breakfast", "lunch", "dinner", "snack"] = "snack"
    grams: Positive | None = None
    food_description: str = Field(min_length=1, max_length=2000)
    food_name: str = Field(min_length=1, max_length=2000)
    calories: NonNegative
    protein: NonNegative
    fat: NonNegative
    carbs: NonNegative
    sugar: NonNegative
    fiber: NonNegative


class Exercise(Model):
    name: str = Field(min_length=1, max_length=120)
    sets: int = Field(ge=1, le=100)
    reps: int = Field(ge=1, le=1000)
    weight_kg: NonNegative = 0


class CompletedSet(Model):
    warmup: bool = False
    superset: str = Field(default="", max_length=20)
    notes: str = Field(default="", max_length=500)
    name: str = Field(min_length=1, max_length=120)
    reps: int = Field(ge=1, le=1000)
    weight_kg: float = Field(ge=0, le=1000)


class TrainingLogCreate(Dated):
    sets_log: list[CompletedSet] = Field(default_factory=list, max_length=1500)
    program_name: str | None = Field(default=None, max_length=100)
    exercises: list[Exercise] = Field(default_factory=list, max_length=100)
    training_type: Literal['Strength', 'Cardio', 'HIIT', 'Yoga', 'Swimming', 'Cycling', 'Running', 'Walking']
    duration_minutes: int = Field(gt=0, le=1440)


class WaterLogCreate(Dated):
    amount_ml: Positive


class WeightLogCreate(Dated):
    weight_kg: Positive


class FoodAnalyzeRequest(Model):
    description: str = Field(min_length=1, max_length=2000)


def _nutrient_100g(nutrients, name, required=False):
    value = nutrients.get(name + '_100g')
    if value is None and name == 'calories':
        value = nutrients.get('energy-kcal_100g')
        if value is None and nutrients.get('energy_100g') is not None:
            value = float(nutrients['energy_100g']) / 4.184
    if value is None:
        if required:
            raise HTTPException(422, 'This product has incomplete nutrition data. Enter the missing values manually.')
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise HTTPException(502, 'Food provider returned invalid nutrition data.') from None
    if value < 0 or not math.isfinite(value):
        raise HTTPException(502, 'Food provider returned invalid nutrition data.')
    return round(value, 3)


@api_router.get('/food/barcode/{barcode}')
async def food_by_barcode(barcode: str):
    if not re.fullmatch(r'\d{8,14}', barcode):
        raise HTTPException(422, 'Enter an 8 to 14 digit barcode.')
    fields = 'code,product_name,product_name_en,brands,nutriments'
    try:
        async with httpx.AsyncClient(
            timeout=10,
            headers={'User-Agent': 'FitTrack/1.0 (github.com/antonoww03/FitnessTracker)'},
        ) as client:
            response = await client.get(
                f'https://world.openfoodfacts.org/api/v2/product/{barcode}',
                params={'fields': fields},
            )
        if response.status_code != 200:
            raise HTTPException(502, 'Barcode provider is unavailable. Enter nutrition manually.')
        payload = response.json()
    except httpx.TimeoutException:
        raise HTTPException(504, 'Barcode lookup timed out. Try again.') from None
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, 'Barcode provider returned invalid data.') from None
    if payload.get('status') != 1 or not payload.get('product'):
        raise HTTPException(404, 'Product not found. Enter it manually.')
    product = payload['product']
    name = product.get('product_name') or product.get('product_name_en')
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(422, 'This product has no name. Enter it manually.')
    brand = product.get('brands')
    display_name = f'{brand.strip()} · {name.strip()}' if isinstance(brand, str) and brand.strip() else name.strip()
    nutrients = product.get('nutriments') or {}
    values = {
        'calories': _nutrient_100g(nutrients, 'calories', True),
        'protein': _nutrient_100g(nutrients, 'proteins', True),
        'fat': _nutrient_100g(nutrients, 'fat', True),
        'carbs': _nutrient_100g(nutrients, 'carbohydrates', True),
        'sugar': _nutrient_100g(nutrients, 'sugars'),
        'fiber': _nutrient_100g(nutrients, 'fiber'),
    }
    return {
        'barcode': barcode,
        'food_name': display_name,
        'source': 'Open Food Facts',
        'estimated': True,
        'grams': 100,
        'per100': True,
        'missing': [key for key, value in values.items() if value is None],
        **values,
    }


@api_router.get('')
@api_router.get('/')
def health():
    with database() as db:
        db.execute('SELECT 1')
    return {'status': 'ok'}


@api_router.post('/food/analyze')
async def analyze_food(req: FoodAnalyzeRequest):
    key = os.getenv('USDA_API_KEY')
    if not key:
        raise HTTPException(503, 'Food lookup is not configured. Enter nutrition manually or configure USDA_API_KEY.')
    # Each item must have an explicit mass; counts/cups need a conversion that USDA search cannot infer.
    items = [item.strip() for item in re.split(r'[,;\n]+', req.description) if item.strip()]
    if not items or len(items) > 10:
        raise HTTPException(422, 'Enter between 1 and 10 foods with grams, separated by semicolons.')
    parsed = []
    for item in items:
        match = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(kg|g|grams?|kilograms?)\s+(.+)', item, re.I)
        if not match:
            raise HTTPException(422, 'Use grams for each food, e.g. 200 g chicken breast; 100 g rice. Use manual entry for other portions.')
        quantity, unit, query = match.groups()
        grams = float(quantity) * (1000 if unit.lower().startswith('k') else 1)
        if not 0 < grams <= 10000 or re.search(r'\b(?:and|with)\b|\d', query, re.I):
            raise HTTPException(422, 'Use a separate weighed item for each ingredient, up to 10000 g each.')
        parsed.append((grams, query))
    result = {name: 0.0 for name in MACROS}
    names = []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            for grams, query in parsed:
                response = await client.get('https://api.nal.usda.gov/fdc/v1/foods/search', params={
                    'query': query, 'pageSize': 1, 'api_key': key,
                    'dataType': 'Foundation,SR Legacy',
                })
                if response.status_code != 200:
                    raise HTTPException(502, 'Food provider is unavailable. Try again or enter nutrition manually.')
                foods = response.json().get('foods', [])
                if not foods:
                    raise HTTPException(404, f'No food found for: {query}')
                food = foods[0]
                nutrients = {n.get('nutrientId'): n for n in food.get('foodNutrients', [])}
                values = {}
                for macro, nutrient_id in zip(MACROS, (1008, 1003, 1004, 1005, 2000, 1079)):
                    nutrient = nutrients.get(nutrient_id)
                    if macro == 'sugar' and nutrient is None:
                        nutrient = nutrients.get(1063)
                    if macro == 'calories' and nutrient is None:
                        nutrient = nutrients.get(2047) or nutrients.get(2048) or nutrients.get(1062)
                    if nutrient is None:
                        raise HTTPException(422, 'This food has incomplete nutrition data. Try a more specific food or enter nutrition manually.')
                    value = float(nutrient['value'])
                    if macro == 'calories' and nutrient.get('unitName', '').lower() == 'kj':
                        value /= 4.184
                    if value < 0 or not math.isfinite(value):
                        raise ValueError('Invalid nutrient value')
                    values[macro] = value * grams / 100
                for macro in MACROS:
                    result[macro] += values[macro]
                names.append(f"{grams:g} g {food.get('description', query)}")
    except httpx.TimeoutException:
        raise HTTPException(504, 'Food lookup timed out. Please retry; no nutrition was saved.') from None
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise HTTPException(502, 'Food provider returned invalid data. Try again or enter nutrition manually.') from None
    return {'food_name': '; '.join(names), **{k: round(v, 2) for k, v in result.items()}, 'source': 'USDA', 'estimated': True, 'grams': sum(g for g,q in parsed)}


@api_router.post('/food')
def create_food(food: FoodLogCreate):
    return save('food', food.model_dump())


@api_router.get('/food')
def get_food(date: Date):
    return records('food', date)


@api_router.delete('/food/{id}')
def delete_food(id: str):
    return remove('food', id)


@api_router.post('/training')
def create_training(training: TrainingLogCreate):
    return save('training', training.model_dump())


@api_router.get('/training')
def get_training(date: Date):
    return records('training', date)


@api_router.delete('/training/{id}')
def delete_training(id: str):
    return remove('training', id)


@api_router.post('/water')
def add_water(water: WaterLogCreate):
    return save('water', water.model_dump())


@api_router.get('/water')
def get_water(date: Date):
    return records('water', date)


@api_router.delete('/water')
def reset_water(date: Date):
    with database() as db:
        db.execute('DELETE FROM records WHERE kind=? AND date=?', (scoped('water'), str(date)))
    return {'ok': True}


@api_router.delete('/water/{id}')
def delete_water(id: str):
    return remove('water', id)


@api_router.post('/weight')
def set_weight(weight: WeightLogCreate):
    return save('weight', weight.model_dump(), identifier=weight.date)


@api_router.get('/weight')
def get_weight(date: Date | None = None):
    entries = records('weight', date)
    return entries[0] if entries else None


@api_router.delete('/weight/{date}')
def delete_weight(date: Date):
    return remove('weight', str(date))


@api_router.get('/streak/water')
def water_streak(date: Date | None = None):
    anchor = date or Date.today()
    days = {row['date'] for row in records('water')}
    if str(anchor) not in days:
        anchor -= timedelta(days=1)
    count = 0
    while str(anchor) in days:
        count += 1
        anchor -= timedelta(days=1)
    return {'streak': count}


@api_router.get('/goals')
def get_goals():
    saved = records('goals')
    return {name: saved[0][name] for name in MACROS} if saved else DEFAULT_GOALS.copy()


@api_router.put('/goals')
def update_goals(goals: Goals, date: Date | None = None):
    if date is not None and records('day_goals'):
        from backend.advanced import plan, day_goals
        value = day_goals()
        value[plan(date)['day_type']] = goals.model_dump()
        save('day_goals', value, 'settings')
        return goals
    save('goals', goals.model_dump(), identifier='daily')
    return goals


@api_router.get('/summary')
def summary(date: Date):
    foods, trainings, waters = (records(kind, date) for kind in ('food', 'training', 'water'))
    weight = get_weight(date)
    return {
        'date': str(date), 'totals': {key: round(sum(f[key] for f in foods), 2) for key in MACROS},
        'goals': goals_for_day(date), 'total_training_minutes': sum(t['duration_minutes'] for t in trainings),
        'total_water_ml': sum(w['amount_ml'] for w in waters), 'weight_kg': weight['weight_kg'] if weight else None,
        'food_count': len(foods), 'training_count': len(trainings),
    }


@api_router.post('/reports/save')
def save_report(date: Date):
    data = summary(date)
    report = {'date': str(date), 'totals': data['totals'], 'goals': data['goals'],
              'training_minutes': data['total_training_minutes'], 'water_ml': data['total_water_ml'],
              'weight_kg': data['weight_kg'], 'food_count': data['food_count'], 'training_count': data['training_count']}
    return {'ok': True, 'report': save('report', report, identifier=str(date))}


Period = Literal['week', 'month', 'year', 'all']


@api_router.get('/reports')
def get_reports(period: Period = 'all', date: Date | None = None):
    anchor = date or Date.today()
    days = {r['date'] for kind in ('food', 'training', 'water', 'weight', 'report') for r in records(kind)}
    result = [live_report(Date.fromisoformat(day)) for day in sorted(days, reverse=True)]
    if period == 'week':
        start = anchor - timedelta(days=anchor.weekday())
        end = start + timedelta(days=6)
    elif period == 'month':
        start = anchor.replace(day=1)
        end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    elif period == 'year':
        start, end = anchor.replace(month=1, day=1), anchor.replace(month=12, day=31)
    else:
        return result
    return [row for row in result if str(start) <= row['date'] <= str(end)]


@api_router.delete('/reports/{date}')
def delete_report(date: Date):
    return remove('report', str(date))


@api_router.get('/coach/tips')
def coach_tips(date: Date):
    data = summary(date)
    # Transparent, deterministic feedback rather than presenting rules as AI/medical advice.
    tips = []
    if not data['food_count']:
        tips.append({'type': 'general', 'tip': 'No food is logged for this date. Log meals to see a summary.'})
    else:
        for macro in MACROS:
            amount, goal = data['totals'][macro], data['goals'][macro]
            unit = 'kcal' if macro == 'calories' else 'g'
            tips.append({'type': macro, 'tip': f'{macro.capitalize()}: {amount:g} {unit} logged' + (f' against your {goal:g} {unit} target.' if goal else '. No target set.')})
    tips.append({'type': 'water', 'tip': f"Water logged: {data['total_water_ml']:g} ml. Daily target: {get_preferences()['water_goal_ml']:g} ml."})
    if data['total_training_minutes']:
        tips.append({'type': 'general', 'tip': f"Training logged: {data['total_training_minutes']} minutes."})
    if get_preferences()['language'] == 'bg':
        labels = dict(zip(MACROS, ('Калории', 'Протеин', 'Мазнини', 'Въглехидрати', 'Захари', 'Фибри')))
        tips = [{'type': macro, 'tip': f"{labels[macro]}: {data['totals'][macro]:g} / {data['goals'][macro]:g} {'kcal' if macro == 'calories' else 'г'}."} for macro in MACROS]
        tips.append({'type': 'water', 'tip': f"Вода: {data['total_water_ml']:g} / {get_preferences()['water_goal_ml']:g} мл."})
        tips.append({'type': 'general', 'tip': f"Тренировки: {data['total_training_minutes']} минути."})
    return {'tips': tips, 'totals': data['totals'], 'water_ml': data['total_water_ml'], 'source': 'logged-data'}


@api_router.get('/export')
def export_reports(format: str = 'csv', period: Period = 'all', date: Date | None = None):
    reports = get_reports(period, date)
    columns = ['date', *MACROS, 'water_ml', 'weight_kg', 'training_minutes', 'food_count', 'training_count']
    rows = [{**r, **r['totals']} for r in reports]
    if format == 'csv':
        output = StringIO()
        writer = csv.DictWriter(output, fieldnames=columns, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)
        body, media_type = output.getvalue().encode('utf-8-sig'), 'text/csv'
    elif format == 'pdf':
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.styles import getSampleStyleSheet
        output = BytesIO()
        document = SimpleDocTemplate(output, pagesize=landscape(A4), leftMargin=24, rightMargin=24)
        labels = ['Date', 'kcal', 'Protein g', 'Fat g', 'Carbs g', 'Sugar g', 'Fiber g', 'Water ml', 'Weight kg', 'Train min', 'Foods', 'Workouts']
        table = Table([labels] + [[str(r.get(c, '') if r.get(c) is not None else '') for c in columns] for r in rows], repeatRows=1)
        table.setStyle(TableStyle([('FONTSIZE', (0, 0), (-1, -1), 7), ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey), ('GRID', (0, 0), (-1, -1), .25, colors.grey)]))
        document.build([Paragraph('FitTrack live reports', getSampleStyleSheet()['Title']), Spacer(1, 12), table])
        body, media_type = output.getvalue(), 'application/pdf'
    else:
        raise HTTPException(400, 'Supported formats: csv, pdf')
    return Response(body, media_type=media_type, headers={'Content-Disposition': f'attachment; filename="fittrack-{period}.{format}"'})




class Credentials(Model):
    model_config = ConfigDict(allow_inf_nan=False, str_strip_whitespace=False, extra="forbid")
    username: str = Field(pattern=r'^[A-Za-z0-9_.-]{3,40}$')
    password: str = Field(min_length=12, max_length=128)


def password_hash(password, salt):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**15, r=8, p=1, maxmem=64*1024*1024).hex()


def session_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


@app.middleware('http')
async def authenticate(request: Request, call_next):
    path = request.url.path
    if not path.startswith('/api/') or os.getenv('FITTRACK_AUTH_DISABLED') == '1':
        return await call_next(request)
    if request.method == 'OPTIONS':
        return await call_next(request)
    if request.method not in ('GET', 'HEAD'):
        # Custom header cannot be sent cross-origin without an approved CORS preflight.
        if request.headers.get('x-requested-with') != 'FitTrack':
            return JSONResponse({'detail': 'Missing request protection header'}, status_code=403)
        origin = request.headers.get('origin')
        allowed = os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000').split(',')
        if origin and origin != str(request.base_url).rstrip('/') and origin not in allowed:
            return JSONResponse({'detail': 'Origin not allowed'}, status_code=403)
    if path in ('/api/auth/login', '/api/auth/register', '/api/auth/reset-password'):
        return await call_next(request)
    token = request.cookies.get('fittrack_session', '')
    with database() as db:
        user = db.execute('SELECT user_id FROM sessions WHERE token=? AND expires>?', (session_hash(token), time.time())).fetchone()
    if not user:
        return JSONResponse({'detail': 'Please sign in'}, status_code=401)
    operation = request.headers.get('x-operation-id') if request.method == 'POST' else None
    if operation and not re.fullmatch(r'[A-Za-z0-9-]{16,80}',operation):
        return JSONResponse({'detail':'Invalid operation ID'},status_code=422)
    op_marker = OPERATION_ID.set(operation)
    marker = CURRENT_USER.set(user[0])
    try:
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response
    finally:
        CURRENT_USER.reset(marker)
        OPERATION_ID.reset(op_marker)


def auth_attempt(request, username):
    # Persistent limits shared across workers; never trust forwarded IP headers here.
    keys = [f"ip:{request.client.host if request.client else 'unknown'}", f'user:{username}']
    blocked = False
    with database() as db:
        db.execute('DELETE FROM attempts WHERE until<?', (time.time(),))
        for key in keys:
            db.execute('INSERT INTO attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1', (key, time.time()+900))
            blocked |= db.execute('SELECT count FROM attempts WHERE key=?', (key,)).fetchone()[0] > 20
    if blocked:
        raise HTTPException(429, 'Too many sign-in attempts. Try again in 15 minutes.')


def start_session(user_id, username, response):
    token = secrets.token_urlsafe(32)
    with database() as db:
        db.execute('DELETE FROM sessions WHERE expires<?', (time.time(),))
        db.execute('INSERT INTO sessions VALUES (?,?,?)', (session_hash(token), user_id, time.time()+7*86400))
    response.set_cookie('fittrack_session', token, max_age=7*86400, httponly=True, secure=os.getenv('FITTRACK_COOKIE_SECURE', '1') != '0', samesite='strict', path='/api')
    response.headers['Cache-Control'] = 'no-store'
    return {'id': user_id, 'username': username}


@api_router.post('/auth/register')
def register(body: Credentials, request: Request, response: Response):
    username = body.username.lower()
    auth_attempt(request, username)
    salt, user_id = secrets.token_hex(16), str(uuid.uuid4())
    hashed = password_hash(body.password, salt)
    try:
        with database() as db:
            db.execute('INSERT INTO users VALUES (?,?,?,?)', (user_id, username, salt, hashed))
    except sqlite3.IntegrityError:
        raise HTTPException(409, 'Username is unavailable') from None
    from backend.advanced import issue_recovery
    return {**start_session(user_id, username, response), "recovery_code": issue_recovery(user_id)}


@api_router.post('/auth/login')
def login(body: Credentials, request: Request, response: Response):
    username = body.username.lower()
    auth_attempt(request, username)
    with database() as db:
        user = db.execute('SELECT id,salt,password FROM users WHERE username=?', (username,)).fetchone()
    candidate = password_hash(body.password, user[1] if user else '00'*16)
    if not user or not secrets.compare_digest(candidate, user[2]):
        raise HTTPException(401, 'Incorrect username or password')
    return start_session(user[0], username, response)


@api_router.get('/auth/me')
def me():
    with database() as db:
        user = db.execute('SELECT id,username FROM users WHERE id=?', (CURRENT_USER.get(),)).fetchone()
    return {'id': user[0], 'username': user[1]} if user else {'id': 'local', 'username': 'Local mode'}


@api_router.post('/auth/logout')
def logout(request: Request, response: Response):
    with database() as db:
        db.execute('DELETE FROM sessions WHERE token=?', (session_hash(request.cookies.get('fittrack_session', '')),))
    response.delete_cookie('fittrack_session', path='/api')
    return {'ok': True}


class Preferences(Model):
    hidden_sections: list[Literal["water", "weight", "training", "activity", "review"]] = Field(default_factory=list, max_length=5)
    water_goal_ml: float = Field(default=3000, ge=100, le=20000)
    language: Literal['en', 'bg'] = 'en'
    theme: Literal['dark', 'light'] = 'dark'


class Profile(Model):
    first_name: str = Field(default='', max_length=80)
    last_name: str = Field(default='', max_length=80)
    age: int | None = Field(default=None, ge=13, le=120)
    height_cm: float | None = Field(default=None, ge=50, le=280)
    weight_kg: float | None = Field(default=None, ge=20, le=500)
    gender: Literal['', 'male', 'female', 'other', 'prefer_not_to_say'] = ''
    photo_data_url: str | None = Field(default=None, max_length=800_000)

    @field_validator('photo_data_url')
    @classmethod
    def valid_photo(cls, value):
        if value is None:
            return value
        match = re.fullmatch(r'data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})', value)
        if not match:
            raise ValueError('Photo must be a JPEG, PNG, or WebP image')
        try:
            decoded = base64.b64decode(match.group(2), validate=True)
        except (ValueError, binascii.Error):
            raise ValueError('Photo data is invalid') from None
        if len(decoded) > 600_000:
            raise ValueError('Photo must be smaller than 600 KB')
        from PIL import Image, UnidentifiedImageError
        try:
            with Image.open(BytesIO(decoded)) as photo:
                if photo.format != {'jpeg': 'JPEG', 'png': 'PNG', 'webp': 'WEBP'}[match.group(1)]:
                    raise ValueError('Photo format does not match its content')
                if max(photo.size) > 2048:
                    raise ValueError('Photo dimensions are too large')
                photo.verify()
        except (OSError, UnidentifiedImageError, Image.DecompressionBombError):
            raise ValueError('Photo data is invalid') from None
        return value


@api_router.get('/profile')
def get_profile():
    rows = records('profile')
    return Profile.model_validate({k: rows[0][k] for k in Profile.model_fields if k in rows[0]}).model_dump() if rows else Profile().model_dump()


@api_router.put('/profile')
def update_profile(body: Profile):
    save('profile', body.model_dump(), 'profile')
    return body


@api_router.get('/preferences')
def get_preferences():
    rows = records('preferences')
    return Preferences.model_validate({k: rows[0][k] for k in Preferences.model_fields if k in rows[0]}).model_dump() if rows else Preferences().model_dump()


@api_router.put('/preferences')
def preferences(body: Preferences):
    save('preferences', body.model_dump(), 'settings')
    return body


KINDS = Literal['food', 'training', 'water', 'weight']
MODELS = {'food': FoodLogCreate, 'training': TrainingLogCreate, 'water': WaterLogCreate, 'weight': WeightLogCreate}


def validated(kind, body):
    from pydantic import ValidationError
    try:
        return MODELS[kind].model_validate(body).model_dump()
    except ValidationError:
        raise HTTPException(422, 'Invalid entry values') from None


@api_router.put('/entries/{kind}/{identifier}')
def edit_entry(kind: KINDS, identifier: str, body: dict):
    previous = next((r for r in records(kind) if r['id'] == identifier), None)
    if previous is None:
        raise HTTPException(404, 'Entry not found')
    payload = validated(kind, body)
    if payload['date'] != previous['date']:
        raise HTTPException(422, 'Use copy to move an entry to another date')
    return save(kind, {**payload, 'id': identifier, 'timestamp': previous['timestamp']})


@api_router.get('/history')
def history(start: Date, end: Date, kind: Literal['all', 'food', 'training', 'water', 'weight'] = 'all'):
    if end < start or (end-start).days > 366:
        raise HTTPException(422, 'Choose a range of up to 367 days')
    return sorted([{**r, 'kind': k} for k in MODELS if kind in ('all', k) for r in records(k) if str(start) <= r['date'] <= str(end)], key=lambda r: (r['date'], r.get('timestamp', '')), reverse=True)


@api_router.delete('/entries/{kind}/{identifier}')
def trash_entry(kind: KINDS, identifier: str):
    token = str(uuid.uuid4())
    with database() as db:
        row = db.execute('SELECT payload FROM records WHERE kind=? AND id=?', (scoped(kind), identifier)).fetchone()
        if not row:
            raise HTTPException(404, 'Entry not found')
        payload = {'id': token, 'kind': kind, 'entry': json.loads(row[0]), 'expires': time.time()+86400}
        db.execute('INSERT INTO records VALUES (?,?,?,?)', (scoped('trash'), token, '', json.dumps(payload)))
        db.execute('DELETE FROM records WHERE kind=? AND id=?', (scoped(kind), identifier))
    return {'undo_token': token}


@api_router.post('/undo/{token}')
def undo(token: str):
    with database() as db:
        row = db.execute('SELECT payload FROM records WHERE kind=? AND id=?', (scoped('trash'), token)).fetchone()
        if not row or json.loads(row[0])['expires'] < time.time():
            raise HTTPException(404, 'Undo expired')
        trash = json.loads(row[0]); item = trash['entry']
        if db.execute('SELECT 1 FROM records WHERE kind=? AND id=?', (scoped(trash['kind']), item['id'])).fetchone():
            raise HTTPException(409, 'A newer entry exists; it will not be overwritten')
        db.execute('INSERT INTO records VALUES (?,?,?,?)', (scoped(trash['kind']), item['id'], item['date'], json.dumps(item)))
        db.execute('DELETE FROM records WHERE kind=? AND id=?', (scoped('trash'), token))
    return item


class CopyDay(Model):
    source: Date
    target: Date
    kinds: list[KINDS] = Field(default_factory=lambda: ['food', 'training'], min_length=1)


@api_router.post('/copy-day')
def copy_day(body: CopyDay):
    if body.source == body.target:
        raise HTTPException(422, 'Choose a different source date')
    count = 0
    with database() as db:
        for kind in set(body.kinds):
            for (raw,) in db.execute('SELECT payload FROM records WHERE kind=? AND date=?', (scoped(kind), str(body.source))).fetchall():
                item = json.loads(raw); item.update(date=str(body.target), id=str(body.target) if kind=='weight' else str(uuid.uuid4()), timestamp=datetime.now(timezone.utc).isoformat())
                if kind == 'weight' and db.execute('SELECT 1 FROM records WHERE kind=? AND id=?', (scoped(kind), item['id'])).fetchone():
                    raise HTTPException(409, 'Target already has a weight measurement')
                db.execute('INSERT INTO records VALUES (?,?,?,?)', (scoped(kind), item['id'], item['date'], json.dumps(item)))
                count += 1
    return {'copied': count}


class Meal(Model):
    name: str = Field(min_length=1, max_length=100)
    foods: list[FoodLogCreate] = Field(min_length=1, max_length=50)


@api_router.get('/meals')
def meals():
    return records('meal')


@api_router.post('/meals')
def create_meal(body: Meal):
    return save('meal', body.model_dump())


@api_router.delete('/meals/{identifier}')
def delete_meal(identifier: str):
    return remove('meal', identifier)


@api_router.post('/meals/{identifier}/log')
def log_meal(identifier: str, date: Date):
    meal = next((r for r in records('meal') if r['id'] == identifier), None)
    if not meal:
        raise HTTPException(404, 'Meal not found')
    with database() as db:
        for item in meal['foods']:
            item = {**item, 'date': str(date), 'id': str(uuid.uuid4()), 'timestamp': datetime.now(timezone.utc).isoformat()}
            db.execute('INSERT INTO records VALUES (?,?,?,?)', (scoped('food'), item['id'], item['date'], json.dumps(item)))
    return {'logged': len(meal['foods'])}


def live_report(day):
    data = summary(day)
    return {**data, 'id': str(day), 'water_ml': data['total_water_ml'], 'training_minutes': data['total_training_minutes']}


@api_router.get('/progress')
def progress(start: Date, end: Date):
    if end < start or (end-start).days > 366:
        raise HTTPException(422, 'Choose a range of up to 367 days')
    weights = {r['date']: r['weight_kg'] for r in records('weight')}
    result = []
    for offset in range((end-start).days+1):
        day = start+timedelta(days=offset)
        recent = [v for d,v in weights.items() if str(day-timedelta(days=6)) <= d <= str(day)]
        result.append({**live_report(day), 'weight_average_7d': round(sum(recent)/len(recent), 2) if recent else None, 'weight_samples_7d': len(recent)})
    return result


@api_router.get('/backup')
def backup():
    data = {'version': 1, 'created_at': datetime.now(timezone.utc).isoformat(), 'records': {k: records(k) for k in (*MODELS, *ADVANCED_MODELS, 'goals', 'preferences', 'profile', 'meal', 'report')}}
    return Response(json.dumps(data), media_type='application/json', headers={'Content-Disposition': 'attachment; filename="fittrack-backup.json"'})


@api_router.post('/backup/restore')
async def restore(request: Request):
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 5_000_000:
            raise HTTPException(413, 'Backup must be smaller than 5 MB')
    try:
        body = json.loads(raw)
        assert body['version'] == 1 and isinstance(body['records'], dict)
        clean = []
        allowed = {**MODELS, **ADVANCED_MODELS, 'goals': Goals, 'preferences': Preferences, 'profile': Profile, 'meal': Meal}
        for kind, rows in body['records'].items():
            assert kind in (*allowed, 'report') and isinstance(rows, list)
            for row in rows:
                if kind == 'report':
                    value = {'date': str(Date.fromisoformat(row['date']))}
                else:
                    value = allowed[kind].model_validate({k: v for k,v in row.items() if k not in ('id','timestamp')}).model_dump()
                identifier = value['date'] if kind in ('weight', 'report', 'measurements', 'day_plan') else 'daily' if kind=='goals' else 'settings' if kind in ('preferences','day_goals') else 'profile' if kind == 'profile' else str(row.get('id') or uuid.uuid4())
                assert len(identifier) <= 100
                value.update(id=identifier, timestamp=datetime.now(timezone.utc).isoformat())
                clean.append((scoped(kind), identifier, value.get('date',''), json.dumps(value)))
        assert len(clean) <= 20000
    except (ValueError, KeyError, TypeError, AttributeError, AssertionError):
        raise HTTPException(422, 'Invalid backup; no data changed') from None
    # Merge by stable ID, never erase other entries; one transaction for the full file.
    with database() as db:
        db.executemany('INSERT INTO records VALUES (?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET date=excluded.date,payload=excluded.payload', clean)
    return {'restored': len(clean)}


def goals_for_day(day):
    from backend.advanced import plan
    return plan(day)['goals']

from backend.advanced import router as advanced_router, ADVANCED_MODELS
app.include_router(api_router, prefix='/api')
app.include_router(advanced_router, prefix='/api')

# Daily consistent SQLite backups, including accounts, retained locally for seven days.
# An operator should copy this private directory to independent storage.
@app.on_event('startup')
async def start_backups():
    import asyncio
    import logging
    if os.getenv('FITTRACK_AUTO_BACKUP', '1') != '1':
        return
    with database():
        pass
    async def loop():
        from backend.maintenance import backup_database
        directory = Path(os.getenv('FITTRACK_BACKUP_DIR', str(DB_PATH.parent / 'backups')))
        while True:
            try:
                name = datetime.now(timezone.utc).strftime('fittrack-%Y%m%d-%H%M%S-%f.sqlite3')
                await asyncio.to_thread(backup_database, directory / name)
                for old in sorted(directory.glob('fittrack-*.sqlite3'), reverse=True)[7:]:
                    old.unlink()
            except Exception:
                logging.getLogger('fittrack').exception('Automatic backup failed')
            await asyncio.sleep(86400)
    app.state.backup_task = asyncio.create_task(loop())


@app.on_event('shutdown')
async def stop_backups():
    import asyncio
    task = getattr(app.state, 'backup_task', None)
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
