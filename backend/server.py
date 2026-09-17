"""Single-user fitness API with durable SQLite storage."""
from contextlib import contextmanager
from datetime import date as Date, datetime, timedelta, timezone
from io import BytesIO, StringIO
from pathlib import Path
from typing import Annotated, Literal
import csv
import json
import math
import os
import re
import sqlite3
import uuid

import httpx
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException
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
    allow_credentials=False, allow_methods=['GET', 'POST', 'PUT', 'DELETE'],
    allow_headers=['Content-Type'],
)
api_router = APIRouter()


@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=15)
    try:
        with connection:
            connection.execute('CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, date TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind, id))')
            connection.execute('CREATE INDEX IF NOT EXISTS records_date ON records(kind, date)')
            yield connection
    finally:
        connection.close()


def save(kind, payload, identifier=None):
    record = dict(payload)
    record.setdefault('id', identifier or str(uuid.uuid4()))
    record.setdefault('timestamp', datetime.now(timezone.utc).isoformat())
    with database() as db:
        db.execute('INSERT INTO records VALUES (?, ?, ?, ?) ON CONFLICT(kind,id) DO UPDATE SET date=excluded.date,payload=excluded.payload',
                   (kind, record['id'], record.get('date', ''), json.dumps(record, allow_nan=False)))
    return record


def records(kind, day=None):
    with database() as db:
        query = 'SELECT payload FROM records WHERE kind=?'
        params = [kind]
        if day is not None:
            query += ' AND date=?'
            params.append(str(day))
        return [json.loads(row[0]) for row in db.execute(query + ' ORDER BY date DESC, rowid DESC', params)]


def remove(kind, identifier):
    with database() as db:
        result = db.execute('DELETE FROM records WHERE kind=? AND id=?', (kind, identifier))
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
    food_description: str = Field(min_length=1, max_length=2000)
    food_name: str = Field(min_length=1, max_length=2000)
    calories: NonNegative
    protein: NonNegative
    fat: NonNegative
    carbs: NonNegative
    sugar: NonNegative
    fiber: NonNegative


class TrainingLogCreate(Dated):
    training_type: Literal['Strength', 'Cardio', 'HIIT', 'Yoga', 'Swimming', 'Cycling', 'Running', 'Walking']
    duration_minutes: int = Field(gt=0, le=1440)


class WaterLogCreate(Dated):
    amount_ml: Positive


class WeightLogCreate(Dated):
    weight_kg: Positive


class FoodAnalyzeRequest(Model):
    description: str = Field(min_length=1, max_length=2000)


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
    return {'food_name': '; '.join(names), **{k: round(v, 2) for k, v in result.items()}, 'source': 'USDA', 'estimated': True}


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
        db.execute('DELETE FROM records WHERE kind=? AND date=?', ('water', str(date)))
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
def update_goals(goals: Goals):
    save('goals', goals.model_dump(), identifier='daily')
    return goals


@api_router.get('/summary')
def summary(date: Date):
    foods, trainings, waters = (records(kind, date) for kind in ('food', 'training', 'water'))
    weight = get_weight(date)
    return {
        'date': str(date), 'totals': {key: round(sum(f[key] for f in foods), 2) for key in MACROS},
        'goals': get_goals(), 'total_training_minutes': sum(t['duration_minutes'] for t in trainings),
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
    result = records('report')
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
    tips.append({'type': 'water', 'tip': f"Water logged: {data['total_water_ml']:g} ml. The bottle display uses a 3000 ml reference."})
    if data['total_training_minutes']:
        tips.append({'type': 'general', 'tip': f"Training logged: {data['total_training_minutes']} minutes."})
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
        document.build([Paragraph('FitTrack saved reports', getSampleStyleSheet()['Title']), Spacer(1, 12), table])
        body, media_type = output.getvalue(), 'application/pdf'
    else:
        raise HTTPException(400, 'Supported formats: csv, pdf')
    return Response(body, media_type=media_type, headers={'Content-Disposition': f'attachment; filename="fittrack-{period}.{format}"'})


app.include_router(api_router, prefix='/api')
