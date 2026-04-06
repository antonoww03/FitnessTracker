from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
import uuid
import requests
from pathlib import Path
from pydantic import BaseModel, Field
from datetime import datetime, timezone

# ---------------- ENV ----------------

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

print("🔥 FAST USDA BACKEND LOADED 🔥")
print("USDA KEY:", os.environ.get("USDA_API_KEY"))

# ---------------- APP ----------------

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router = APIRouter()

# ---------------- MODELS ----------------

class FoodAnalyzeRequest(BaseModel):
    description: str

class FoodLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    food_description: str
    food_name: str
    calories: float
    protein: float
    fat: float
    carbs: float
    sugar: float
    fiber: float
    date: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class FoodLogCreate(BaseModel):
    food_description: str
    food_name: str
    calories: float
    protein: float
    fat: float
    carbs: float
    sugar: float
    fiber: float
    date: str

class TrainingLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    training_type: str
    duration_minutes: int
    date: str

class TrainingLogCreate(BaseModel):
    training_type: str
    duration_minutes: int
    date: str

class WaterLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    amount_ml: float
    date: str

class WaterLogCreate(BaseModel):
    amount_ml: float
    date: str

# ---------------- STORAGE ----------------

food_storage = []
training_storage = []
water_storage = []
cache = {}  # 🔥 caching

# ---------------- USDA ANALYZE ----------------

@api_router.post("/food/analyze")
async def analyze_food(req: FoodAnalyzeRequest):
    try:
        query = req.description.strip().lower()

        print("🔍 Searching:", query)

        # 🔥 CACHE HIT
        if query in cache:
            print("⚡ CACHE HIT")
            return cache[query]

        url = "https://api.nal.usda.gov/fdc/v1/foods/search"

        res = requests.get(
            url,
            params={
                "query": query,
                "pageSize": 1,
                "api_key": os.environ.get("USDA_API_KEY")
            },
            timeout=3  # 🔥 супер важно
        )

        if res.status_code != 200:
            raise Exception(f"USDA error: {res.status_code}")

        data = res.json()

        foods = data.get("foods", [])
        if not foods:
            raise Exception("No food found")

        food = foods[0]

        nutrients = {}
        for n in food.get("foodNutrients", []):
            nutrients[n["nutrientName"]] = n.get("value", 0)

        result = {
            "food_name": food.get("description", query),
            "calories": nutrients.get("Energy", 0),
            "protein": nutrients.get("Protein", 0),
            "fat": nutrients.get("Total lipid (fat)", 0),
            "carbs": nutrients.get("Carbohydrate, by difference", 0),
            "sugar": nutrients.get("Sugars, total including NLEA", 0),
            "fiber": nutrients.get("Fiber, total dietary", 0),
        }

        # 🔥 SAVE CACHE
        cache[query] = result

        print("✅ RESULT:", result)

        return result

    except requests.exceptions.Timeout:
        print("⏱️ TIMEOUT")

        return {
            "food_name": query,
            "calories": 0,
            "protein": 0,
            "fat": 0,
            "carbs": 0,
            "sugar": 0,
            "fiber": 0,
        }

    except Exception as e:
        print("🔥 ERROR:", str(e))
        raise HTTPException(status_code=500, detail=str(e))

# ---------------- FOOD ----------------

@api_router.post("/food")
async def create_food(food: FoodLogCreate):
    f = FoodLog(**food.model_dump())
    food_storage.append(f)
    return f

@api_router.get("/food")
async def get_food(date: str):
    return [f for f in food_storage if f.date == date]

@api_router.delete("/food/{id}")
async def delete_food(id: str):
    global food_storage
    food_storage = [f for f in food_storage if f.id != id]
    return {"ok": True}

# ---------------- TRAINING ----------------

@api_router.post("/training")
async def create_training(t: TrainingLogCreate):
    training_storage.append(TrainingLog(**t.model_dump()))
    return {"ok": True}

@api_router.get("/training")
async def get_training(date: str):
    return [t for t in training_storage if t.date == date]

@api_router.delete("/training/{id}")
async def delete_training(id: str):
    global training_storage
    training_storage = [t for t in training_storage if t.id != id]
    return {"ok": True}

# ---------------- WATER ----------------

@api_router.post("/water")
async def add_water(w: WaterLogCreate):
    water_storage.append(WaterLog(**w.model_dump()))
    return {"ok": True}

@api_router.get("/water")
async def get_water(date: str):
    return [w for w in water_storage if w.date == date]

@api_router.delete("/water")
async def reset_water(date: str):
    global water_storage
    water_storage = [w for w in water_storage if w.date != date]
    return {"ok": True}

# ---------------- STREAK ----------------

@api_router.get("/streak/water")
async def water_streak():
    return {"streak": 0}

# ---------------- GOALS ----------------

@api_router.get("/goals")
async def get_goals():
    return {
        "calories": 2000,
        "protein": 150,
        "fat": 65,
        "carbs": 250,
        "sugar": 50,
        "fiber": 30,
    }

# ---------------- SUMMARY ----------------

@api_router.get("/summary")
async def summary(date: str):
    foods = [f for f in food_storage if f.date == date]
    trainings = [t for t in training_storage if t.date == date]
    waters = [w for w in water_storage if w.date == date]

    return {
        "totals": {
            "calories": sum(f.calories for f in foods),
            "protein": sum(f.protein for f in foods),
            "fat": sum(f.fat for f in foods),
            "carbs": sum(f.carbs for f in foods),
            "sugar": sum(f.sugar for f in foods),
            "fiber": sum(f.fiber for f in foods),
        },
        "goals": {
            "calories": 2000,
            "protein": 150,
            "fat": 65,
            "carbs": 250,
            "sugar": 50,
            "fiber": 30,
        },
        "total_training_minutes": sum(t.duration_minutes for t in trainings),
        "total_water_ml": sum(w.amount_ml for w in waters),
        "weight_kg": None
    }

# ---------------- REGISTER ----------------

app.include_router(api_router, prefix="/api")

logging.basicConfig(level=logging.DEBUG)