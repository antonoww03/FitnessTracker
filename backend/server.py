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
from datetime import datetime, timezone
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

# --- Summary ---

@api_router.get("/summary")
async def get_summary(date: str):
    food_logs = await db.food_logs.find({"date": date}, {"_id": 0}).to_list(1000)
    training_logs = await db.training_logs.find({"date": date}, {"_id": 0}).to_list(1000)
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

    return {
        "date": date,
        "totals": totals,
        "goals": goals,
        "total_training_minutes": total_training_minutes,
        "food_count": len(food_logs),
        "training_count": len(training_logs),
    }

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
