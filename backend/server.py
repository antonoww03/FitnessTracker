from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import json
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime, timezone, timedelta
from emergentintegrations.llm.chat import LlmChat, UserMessage

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# --- Models ---

class FoodAnalysis(BaseModel):
    food_name: str
    calories: float
    protein: float
    fat: float
    carbs: float
    sugar: float
    fiber: float

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
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class TrainingLogCreate(BaseModel):
    training_type: str
    duration_minutes: int
    date: str

class DailyGoals(BaseModel):
    calories: float = 2000
    protein: float = 150
    fat: float = 65
    carbs: float = 250
    sugar: float = 50
    fiber: float = 30

class WeightLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    weight_kg: float
    date: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class WeightLogCreate(BaseModel):
    weight_kg: float
    date: str

class WaterLog(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    amount_ml: float
    date: str
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

class WaterLogCreate(BaseModel):
    amount_ml: float
    date: str

# --- AI Food Analysis ---

@api_router.post("/food/analyze", response_model=FoodAnalysis)
async def analyze_food(request: FoodAnalyzeRequest):
    api_key = os.environ.get('EMERGENT_LLM_KEY')
    if not api_key:
        raise HTTPException(status_code=500, detail="LLM API key not configured")

    chat = LlmChat(
        api_key=api_key,
        session_id=str(uuid.uuid4()),
        system_message="""You are a precise nutrition expert. Analyze the food described and return ONLY a valid JSON object with these exact keys:
- food_name: a clean, short name for the food items (string)
- calories: total calories in kcal (number)
- protein: grams of protein (number)
- fat: grams of fat (number)
- carbs: grams of carbohydrates (number)
- sugar: grams of sugar (number)
- fiber: grams of fiber (number)

If multiple items are mentioned, sum all values. Be as accurate as possible using standard nutritional databases. Return ONLY the JSON object, no markdown, no explanation."""
    )

    user_message = UserMessage(text=request.description)
    response = await chat.send_message(user_message)

    try:
        response_text = response.strip()
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            json_lines = []
            inside = False
            for line in lines:
                if line.startswith("```") and not inside:
                    inside = True
                    continue
                elif line.startswith("```") and inside:
                    break
                elif inside:
                    json_lines.append(line)
            response_text = "\n".join(json_lines)
        data = json.loads(response_text)
        return FoodAnalysis(**data)
    except Exception as e:
        logger.error(f"Failed to parse AI response: {response} - Error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to parse AI response: {str(e)}")

# --- Food CRUD ---

@api_router.post("/food", response_model=FoodLog)
async def create_food_log(food: FoodLogCreate):
    food_log = FoodLog(**food.model_dump())
    doc = food_log.model_dump()
    await db.food_logs.insert_one(doc)
    return food_log

@api_router.get("/food", response_model=List[FoodLog])
async def get_food_logs(date: str):
    logs = await db.food_logs.find({"date": date}, {"_id": 0}).to_list(1000)
    return logs

@api_router.delete("/food/{food_id}")
async def delete_food_log(food_id: str):
    result = await db.food_logs.delete_one({"id": food_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Food log not found")
    return {"message": "Deleted"}

# --- Training CRUD ---

@api_router.post("/training", response_model=TrainingLog)
async def create_training_log(training: TrainingLogCreate):
    training_log = TrainingLog(**training.model_dump())
    doc = training_log.model_dump()
    await db.training_logs.insert_one(doc)
    return training_log

@api_router.get("/training", response_model=List[TrainingLog])
async def get_training_logs(date: str):
    logs = await db.training_logs.find({"date": date}, {"_id": 0}).to_list(1000)
    return logs

@api_router.delete("/training/{training_id}")
async def delete_training_log(training_id: str):
    result = await db.training_logs.delete_one({"id": training_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Training log not found")
    return {"message": "Deleted"}

# --- Goals ---

@api_router.get("/goals", response_model=DailyGoals)
async def get_goals():
    goals = await db.daily_goals.find_one({}, {"_id": 0})
    if not goals:
        return DailyGoals()
    return DailyGoals(**goals)

@api_router.put("/goals", response_model=DailyGoals)
async def update_goals(goals: DailyGoals):
    doc = goals.model_dump()
    await db.daily_goals.update_one({}, {"$set": doc}, upsert=True)
    return goals

# --- Weight ---

@api_router.post("/weight", response_model=WeightLog)
async def log_weight(weight: WeightLogCreate):
    existing = await db.weight_logs.find_one({"date": weight.date}, {"_id": 0})
    if existing:
        await db.weight_logs.update_one(
            {"date": weight.date},
            {"$set": {"weight_kg": weight.weight_kg, "timestamp": datetime.now(timezone.utc).isoformat()}}
        )
        updated = await db.weight_logs.find_one({"date": weight.date}, {"_id": 0})
        return WeightLog(**updated)
    weight_log = WeightLog(**weight.model_dump())
    doc = weight_log.model_dump()
    await db.weight_logs.insert_one(doc)
    return weight_log

@api_router.get("/weight")
async def get_weight(date: str = None):
    if date:
        weight = await db.weight_logs.find_one({"date": date}, {"_id": 0})
        return weight
    weights = await db.weight_logs.find({}, {"_id": 0}).sort("date", -1).to_list(1)
    return weights[0] if weights else None

# --- Water ---

@api_router.post("/water", response_model=WaterLog)
async def log_water(water: WaterLogCreate):
    water_log = WaterLog(**water.model_dump())
    doc = water_log.model_dump()
    await db.water_logs.insert_one(doc)
    return water_log

@api_router.get("/water", response_model=List[WaterLog])
async def get_water_logs(date: str):
    logs = await db.water_logs.find({"date": date}, {"_id": 0}).to_list(1000)
    return logs

@api_router.delete("/water/{water_id}")
async def delete_water_log(water_id: str):
    result = await db.water_logs.delete_one({"id": water_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Water log not found")
    return {"message": "Deleted"}

# --- Summary ---

@api_router.get("/summary")
async def get_summary(date: str):
    food_logs = await db.food_logs.find({"date": date}, {"_id": 0}).to_list(1000)
    training_logs = await db.training_logs.find({"date": date}, {"_id": 0}).to_list(1000)
    water_logs = await db.water_logs.find({"date": date}, {"_id": 0}).to_list(1000)
    weight_doc = await db.weight_logs.find_one({"date": date}, {"_id": 0})
    goals_doc = await db.daily_goals.find_one({}, {"_id": 0})
    goals = goals_doc if goals_doc else DailyGoals().model_dump()

    totals = {
        "calories": round(sum(f.get("calories", 0) for f in food_logs), 1),
        "protein": round(sum(f.get("protein", 0) for f in food_logs), 1),
        "fat": round(sum(f.get("fat", 0) for f in food_logs), 1),
        "carbs": round(sum(f.get("carbs", 0) for f in food_logs), 1),
        "sugar": round(sum(f.get("sugar", 0) for f in food_logs), 1),
        "fiber": round(sum(f.get("fiber", 0) for f in food_logs), 1),
    }

    total_training_minutes = sum(t.get("duration_minutes", 0) for t in training_logs)
    total_water_ml = round(sum(w.get("amount_ml", 0) for w in water_logs))

    return {
        "date": date,
        "totals": totals,
        "goals": goals,
        "total_training_minutes": total_training_minutes,
        "total_water_ml": total_water_ml,
        "weight_kg": weight_doc.get("weight_kg") if weight_doc else None,
        "food_count": len(food_logs),
        "training_count": len(training_logs),
    }

# --- Reports ---

@api_router.get("/reports")
async def get_reports(period: str, date: str):
    import calendar as cal_module
    from datetime import timedelta
    from collections import defaultdict

    target = datetime.strptime(date, "%Y-%m-%d")

    if period == "week":
        start = target - timedelta(days=target.weekday())
        end = start + timedelta(days=6)
    elif period == "month":
        start = target.replace(day=1)
        _, last_day = cal_module.monthrange(target.year, target.month)
        end = target.replace(day=last_day)
    elif period == "year":
        start = target.replace(month=1, day=1)
        end = target.replace(month=12, day=31)
    else:
        start = target
        end = target

    start_str = start.strftime("%Y-%m-%d")
    end_str = end.strftime("%Y-%m-%d")

    food_logs = await db.food_logs.find({"date": {"$gte": start_str, "$lte": end_str}}, {"_id": 0}).to_list(10000)
    water_logs = await db.water_logs.find({"date": {"$gte": start_str, "$lte": end_str}}, {"_id": 0}).to_list(10000)
    training_logs = await db.training_logs.find({"date": {"$gte": start_str, "$lte": end_str}}, {"_id": 0}).to_list(10000)
    weight_logs = await db.weight_logs.find({"date": {"$gte": start_str, "$lte": end_str}}, {"_id": 0}).to_list(10000)

    food_by_date = defaultdict(list)
    water_by_date = defaultdict(list)
    training_by_date = defaultdict(list)
    weight_by_date = {}

    for f in food_logs:
        food_by_date[f["date"]].append(f)
    for w in water_logs:
        water_by_date[w["date"]].append(w)
    for t in training_logs:
        training_by_date[t["date"]].append(t)
    for w in weight_logs:
        weight_by_date[w["date"]] = w.get("weight_kg")

    all_dates = set()
    current = start
    while current <= end:
        all_dates.add(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)

    reports = []
    for d in sorted(all_dates):
        foods = food_by_date.get(d, [])
        waters = water_by_date.get(d, [])
        trains = training_by_date.get(d, [])
        weight = weight_by_date.get(d)

        has_data = foods or waters or trains or weight is not None
        if not has_data:
            continue

        day_totals = {
            "calories": round(sum(f.get("calories", 0) for f in foods), 1),
            "protein": round(sum(f.get("protein", 0) for f in foods), 1),
            "fat": round(sum(f.get("fat", 0) for f in foods), 1),
            "carbs": round(sum(f.get("carbs", 0) for f in foods), 1),
            "sugar": round(sum(f.get("sugar", 0) for f in foods), 1),
            "fiber": round(sum(f.get("fiber", 0) for f in foods), 1),
        }

        reports.append({
            "date": d,
            "totals": day_totals,
            "water_ml": round(sum(w.get("amount_ml", 0) for w in waters)),
            "weight_kg": weight,
            "training_minutes": sum(t.get("duration_minutes", 0) for t in trains),
            "food_count": len(foods),
            "training_count": len(trains),
        })

    if period == "year":
        monthly = defaultdict(lambda: {
            "totals": {"calories": 0, "protein": 0, "fat": 0, "carbs": 0, "sugar": 0, "fiber": 0},
            "water_ml": 0, "training_minutes": 0, "food_count": 0, "training_count": 0,
            "weights": [], "days_count": 0
        })
        for r in reports:
            month_key = r["date"][:7]
            m = monthly[month_key]
            for k in ["calories", "protein", "fat", "carbs", "sugar", "fiber"]:
                m["totals"][k] += r["totals"][k]
            m["water_ml"] += r["water_ml"]
            m["training_minutes"] += r["training_minutes"]
            m["food_count"] += r["food_count"]
            m["training_count"] += r["training_count"]
            if r["weight_kg"] is not None:
                m["weights"].append(r["weight_kg"])
            m["days_count"] += 1

        reports = []
        for month_key in sorted(monthly.keys()):
            m = monthly[month_key]
            avg_weight = round(sum(m["weights"]) / len(m["weights"]), 1) if m["weights"] else None
            days = m["days_count"]
            reports.append({
                "date": month_key,
                "totals": {k: round(v / days, 1) if days > 0 else 0 for k, v in m["totals"].items()},
                "water_ml": round(m["water_ml"] / days) if days > 0 else 0,
                "weight_kg": avg_weight,
                "training_minutes": m["training_minutes"],
                "food_count": m["food_count"],
                "training_count": m["training_count"],
                "days_count": days,
                "is_monthly": True,
            })

    return reports

# --- Water Streak ---

@api_router.get("/streak/water")
async def get_water_streak():
    pipeline = [
        {"$group": {"_id": "$date"}},
        {"$sort": {"_id": -1}}
    ]
    results = await db.water_logs.aggregate(pipeline).to_list(1000)
    date_set = {r["_id"] for r in results}

    today = datetime.now(timezone.utc)
    current = today

    if current.strftime("%Y-%m-%d") not in date_set:
        current = current - timedelta(days=1)

    streak = 0
    while current.strftime("%Y-%m-%d") in date_set:
        streak += 1
        current = current - timedelta(days=1)

    return {"streak": streak}

# --- AI Coach ---

@api_router.get("/coach/tips")
async def get_coach_tips(date: str):
    api_key = os.environ.get('EMERGENT_LLM_KEY')
    if not api_key:
        raise HTTPException(status_code=500, detail="LLM API key not configured")

    food_logs = await db.food_logs.find({"date": date}, {"_id": 0}).to_list(1000)
    water_logs = await db.water_logs.find({"date": date}, {"_id": 0}).to_list(1000)

    totals = {
        "calories": round(sum(f.get("calories", 0) for f in food_logs), 1),
        "protein": round(sum(f.get("protein", 0) for f in food_logs), 1),
        "fat": round(sum(f.get("fat", 0) for f in food_logs), 1),
        "carbs": round(sum(f.get("carbs", 0) for f in food_logs), 1),
        "sugar": round(sum(f.get("sugar", 0) for f in food_logs), 1),
        "fiber": round(sum(f.get("fiber", 0) for f in food_logs), 1),
    }
    water_ml = round(sum(w.get("amount_ml", 0) for w in water_logs))

    prompt = f"""Here's my nutrition intake for today:
- Calories: {totals['calories']} kcal
- Protein: {totals['protein']}g
- Fat: {totals['fat']}g
- Carbs: {totals['carbs']}g
- Sugar: {totals['sugar']}g
- Fiber: {totals['fiber']}g
- Water: {water_ml}ml (my daily goal is 3000ml)

Based on this data, give me tips on what I need more or less of."""

    chat = LlmChat(
        api_key=api_key,
        session_id=str(uuid.uuid4()),
        system_message="""You are a friendly, knowledgeable fitness and nutrition coach. Analyze the user's daily intake and give 3-5 concise, actionable tips.

CRITICAL RULES:
- For calories and macros (protein, fat, carbs, sugar, fiber): Compare their intake against STANDARD recommended daily values for a healthy adult. Standard guidelines: 2000-2500 kcal/day, 50-60g protein minimum (ideally 1.6-2.2g per kg bodyweight for active people), 44-78g fat, 225-325g carbs, less than 25g added sugar, 25-38g fiber.
- For water: Compare against their 3L (3000ml) daily goal and give specific hydration advice.
- Tell them specifically what they need MORE or LESS of.
- Be encouraging and practical. Suggest specific foods when relevant.
- Keep each tip to 1-2 sentences max.
- Return ONLY a valid JSON array of objects. Each object has "type" (one of: "calories", "protein", "fat", "carbs", "sugar", "fiber", "water", "general") and "tip" (string text).
- No markdown, no explanation outside the JSON."""
    )

    user_message = UserMessage(text=prompt)
    response = await chat.send_message(user_message)

    try:
        response_text = response.strip()
        if response_text.startswith("```"):
            lines = response_text.split("\n")
            json_lines = []
            inside = False
            for line in lines:
                if line.startswith("```") and not inside:
                    inside = True
                    continue
                elif line.startswith("```") and inside:
                    break
                elif inside:
                    json_lines.append(line)
            response_text = "\n".join(json_lines)
        tips = json.loads(response_text)
        return {"tips": tips, "totals": totals, "water_ml": water_ml}
    except Exception as e:
        logger.error(f"Failed to parse coach response: {response} - Error: {e}")
        return {"tips": [{"type": "general", "tip": str(response)}], "totals": totals, "water_ml": water_ml}

@api_router.get("/")
async def root():
    return {"message": "FitTrack API"}

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
