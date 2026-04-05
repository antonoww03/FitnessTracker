import requests
import sys
import json
from datetime import datetime, date

class FitTrackAPITester:
    def __init__(self, base_url="https://fittrack-hub-88.preview.emergentagent.com/api"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.test_date = date.today().strftime("%Y-%m-%d")

    def run_test(self, name, method, endpoint, expected_status, data=None, params=None):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}" if endpoint else self.base_url
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    response_data = response.json()
                    print(f"   Response: {json.dumps(response_data, indent=2)[:200]}...")
                except:
                    print(f"   Response: {response.text[:100]}...")
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:200]}...")

            return success, response.json() if response.text and success else {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_health_check(self):
        """Test GET /api/ health check"""
        return self.run_test("Health Check", "GET", "", 200)

    def test_get_default_goals(self):
        """Test GET /api/goals returns default goals"""
        success, response = self.run_test("Get Default Goals", "GET", "goals", 200)
        if success:
            expected_keys = ["calories", "protein", "fat", "carbs", "sugar", "fiber"]
            if all(key in response for key in expected_keys):
                print(f"   ✅ All expected goal fields present")
                return True
            else:
                print(f"   ❌ Missing goal fields: {set(expected_keys) - set(response.keys())}")
        return False

    def test_update_goals(self):
        """Test PUT /api/goals updates goals"""
        test_goals = {
            "calories": 2200,
            "protein": 160,
            "fat": 70,
            "carbs": 260,
            "sugar": 45,
            "fiber": 35
        }
        success, response = self.run_test("Update Goals", "PUT", "goals", 200, test_goals)
        if success and response.get("calories") == 2200:
            print(f"   ✅ Goals updated successfully")
            return True
        return False

    def test_create_training_log(self):
        """Test POST /api/training creates training log"""
        training_data = {
            "training_type": "Strength",
            "duration_minutes": 45,
            "date": self.test_date
        }
        success, response = self.run_test("Create Training Log", "POST", "training", 200, training_data)
        if success and response.get("id"):
            print(f"   ✅ Training log created with ID: {response.get('id')}")
            return response.get("id")
        return None

    def test_get_training_logs(self):
        """Test GET /api/training?date=YYYY-MM-DD"""
        success, response = self.run_test("Get Training Logs", "GET", "training", 200, params={"date": self.test_date})
        if success and isinstance(response, list):
            print(f"   ✅ Retrieved {len(response)} training logs")
            return response
        return []

    def test_delete_training_log(self, training_id):
        """Test DELETE /api/training/{id}"""
        if not training_id:
            print("❌ No training ID provided for deletion test")
            return False
        success, _ = self.run_test("Delete Training Log", "DELETE", f"training/{training_id}", 200)
        return success

    def test_food_analysis(self):
        """Test POST /api/food/analyze with AI analysis"""
        food_description = {
            "description": "2 eggs scrambled with butter and 1 slice of whole wheat toast"
        }
        success, response = self.run_test("AI Food Analysis", "POST", "food/analyze", 200, food_description)
        if success:
            expected_fields = ["food_name", "calories", "protein", "fat", "carbs", "sugar", "fiber"]
            if all(field in response for field in expected_fields):
                print(f"   ✅ AI analysis returned all required fields")
                print(f"   Food: {response.get('food_name')}, Calories: {response.get('calories')}")
                return response
            else:
                print(f"   ❌ Missing analysis fields: {set(expected_fields) - set(response.keys())}")
        return None

    def test_create_food_log(self, analysis_data):
        """Test POST /api/food creates food log"""
        if not analysis_data:
            print("❌ No analysis data provided for food log creation")
            return None
            
        food_data = {
            "food_description": "2 eggs scrambled with butter and 1 slice of whole wheat toast",
            "food_name": analysis_data.get("food_name", "Test Food"),
            "calories": analysis_data.get("calories", 300),
            "protein": analysis_data.get("protein", 20),
            "fat": analysis_data.get("fat", 15),
            "carbs": analysis_data.get("carbs", 25),
            "sugar": analysis_data.get("sugar", 2),
            "fiber": analysis_data.get("fiber", 3),
            "date": self.test_date
        }
        success, response = self.run_test("Create Food Log", "POST", "food", 200, food_data)
        if success and response.get("id"):
            print(f"   ✅ Food log created with ID: {response.get('id')}")
            return response.get("id")
        return None

    def test_get_food_logs(self):
        """Test GET /api/food?date=YYYY-MM-DD"""
        success, response = self.run_test("Get Food Logs", "GET", "food", 200, params={"date": self.test_date})
        if success and isinstance(response, list):
            print(f"   ✅ Retrieved {len(response)} food logs")
            return response
        return []

    def test_delete_food_log(self, food_id):
        """Test DELETE /api/food/{id}"""
        if not food_id:
            print("❌ No food ID provided for deletion test")
            return False
        success, _ = self.run_test("Delete Food Log", "DELETE", f"food/{food_id}", 200)
        return success

    def test_get_summary(self):
        """Test GET /api/summary?date=YYYY-MM-DD"""
        success, response = self.run_test("Get Summary", "GET", "summary", 200, params={"date": self.test_date})
        if success:
            expected_fields = ["date", "totals", "goals", "total_training_minutes", "total_water_ml", "weight_kg", "food_count", "training_count"]
            if all(field in response for field in expected_fields):
                print(f"   ✅ Summary contains all required fields")
                print(f"   Date: {response.get('date')}, Food count: {response.get('food_count')}, Training count: {response.get('training_count')}")
                print(f"   Water: {response.get('total_water_ml')}ml, Weight: {response.get('weight_kg')}kg")
                return True
            else:
                print(f"   ❌ Missing summary fields: {set(expected_fields) - set(response.keys())}")
        return False

    def test_create_water_log(self):
        """Test POST /api/water creates water log"""
        water_data = {
            "amount_ml": 500,
            "date": self.test_date
        }
        success, response = self.run_test("Create Water Log", "POST", "water", 200, water_data)
        if success and response.get("id"):
            print(f"   ✅ Water log created with ID: {response.get('id')}")
            return response.get("id")
        return None

    def test_get_water_logs(self):
        """Test GET /api/water?date=YYYY-MM-DD"""
        success, response = self.run_test("Get Water Logs", "GET", "water", 200, params={"date": self.test_date})
        if success and isinstance(response, list):
            print(f"   ✅ Retrieved {len(response)} water logs")
            return response
        return []

    def test_delete_water_log(self, water_id):
        """Test DELETE /api/water/{id}"""
        if not water_id:
            print("❌ No water ID provided for deletion test")
            return False
        success, _ = self.run_test("Delete Water Log", "DELETE", f"water/{water_id}", 200)
        return success

    def test_create_weight_log(self):
        """Test POST /api/weight creates/updates weight log (upsert)"""
        weight_data = {
            "weight_kg": 75.5,
            "date": self.test_date
        }
        success, response = self.run_test("Create Weight Log", "POST", "weight", 200, weight_data)
        if success and response.get("weight_kg") == 75.5:
            print(f"   ✅ Weight log created/updated: {response.get('weight_kg')}kg")
            return True
        return False

    def test_update_weight_log(self):
        """Test POST /api/weight updates existing weight (upsert functionality)"""
        weight_data = {
            "weight_kg": 76.0,
            "date": self.test_date
        }
        success, response = self.run_test("Update Weight Log (Upsert)", "POST", "weight", 200, weight_data)
        if success and response.get("weight_kg") == 76.0:
            print(f"   ✅ Weight log updated via upsert: {response.get('weight_kg')}kg")
            return True
        return False

    def test_get_weight_by_date(self):
        """Test GET /api/weight?date=YYYY-MM-DD"""
        success, response = self.run_test("Get Weight by Date", "GET", "weight", 200, params={"date": self.test_date})
        if success and response and "weight_kg" in response:
            print(f"   ✅ Retrieved weight: {response.get('weight_kg')}kg")
            return response
        return None

    def test_get_latest_weight(self):
        """Test GET /api/weight (no date parameter)"""
        success, response = self.run_test("Get Latest Weight", "GET", "weight", 200)
        if success and response and "weight_kg" in response:
            print(f"   ✅ Retrieved latest weight: {response.get('weight_kg')}kg")
            return response
        return None

    def test_reports_week(self):
        """Test GET /api/reports?period=week&date=YYYY-MM-DD"""
        success, response = self.run_test("Get Weekly Reports", "GET", "reports", 200, params={"period": "week", "date": self.test_date})
        if success and isinstance(response, list):
            print(f"   ✅ Retrieved {len(response)} weekly report entries")
            if response:
                sample = response[0]
                expected_fields = ["date", "totals", "water_ml", "weight_kg", "training_minutes", "food_count", "training_count"]
                if all(field in sample for field in expected_fields):
                    print(f"   ✅ Report entries contain all required fields")
                    return True
                else:
                    print(f"   ❌ Missing report fields: {set(expected_fields) - set(sample.keys())}")
            return True
        return False

    def test_reports_month(self):
        """Test GET /api/reports?period=month&date=YYYY-MM-DD"""
        success, response = self.run_test("Get Monthly Reports", "GET", "reports", 200, params={"period": "month", "date": self.test_date})
        if success and isinstance(response, list):
            print(f"   ✅ Retrieved {len(response)} monthly report entries")
            return True
        return False

    def test_reports_year(self):
        """Test GET /api/reports?period=year&date=YYYY-MM-DD"""
        success, response = self.run_test("Get Yearly Reports", "GET", "reports", 200, params={"period": "year", "date": self.test_date})
        if success and isinstance(response, list):
            print(f"   ✅ Retrieved {len(response)} yearly report entries")
            if response:
                sample = response[0]
                if sample.get("is_monthly"):
                    print(f"   ✅ Yearly reports are properly aggregated by month")
                    return True
            return True
        return False

    def test_water_streak(self):
        """Test GET /api/streak/water returns water streak count"""
        success, response = self.run_test("Get Water Streak", "GET", "streak/water", 200)
        if success and "streak" in response:
            streak_count = response.get("streak", 0)
            print(f"   ✅ Water streak retrieved: {streak_count} days")
            return True
        return False

    def test_coach_tips(self):
        """Test GET /api/coach/tips?date=YYYY-MM-DD returns AI coach tips"""
        success, response = self.run_test("Get Coach Tips", "GET", "coach/tips", 200, params={"date": self.test_date})
        if success:
            expected_fields = ["tips", "totals", "water_ml"]
            if all(field in response for field in expected_fields):
                tips = response.get("tips", [])
                print(f"   ✅ Coach tips response contains all required fields")
                print(f"   Tips count: {len(tips)}")
                if tips:
                    # Check tip structure
                    sample_tip = tips[0]
                    if "type" in sample_tip and "tip" in sample_tip:
                        print(f"   ✅ Tips have correct structure (type, tip)")
                        print(f"   Sample tip type: {sample_tip.get('type')}")
                        return True
                    else:
                        print(f"   ❌ Tips missing required fields (type, tip)")
                else:
                    print(f"   ✅ Empty tips array (valid for no data)")
                    return True
            else:
                print(f"   ❌ Missing coach response fields: {set(expected_fields) - set(response.keys())}")
        return False

def main():
    print("🚀 Starting FitTrack API Tests (Updated for Water, Weight & Reports)")
    print("=" * 60)
    
    tester = FitTrackAPITester()
    
    # Test basic health check
    tester.test_health_check()
    
    # Test goals management
    tester.test_get_default_goals()
    tester.test_update_goals()
    
    # Test training functionality
    training_id = tester.test_create_training_log()
    tester.test_get_training_logs()
    if training_id:
        tester.test_delete_training_log(training_id)
    
    # Test food analysis and logging
    analysis_data = tester.test_food_analysis()
    food_id = tester.test_create_food_log(analysis_data)
    tester.test_get_food_logs()
    if food_id:
        tester.test_delete_food_log(food_id)
    
    # Test NEW water functionality
    water_id = tester.test_create_water_log()
    tester.test_get_water_logs()
    if water_id:
        tester.test_delete_water_log(water_id)
    
    # Test NEW weight functionality (with upsert)
    tester.test_create_weight_log()
    tester.test_update_weight_log()  # Test upsert functionality
    tester.test_get_weight_by_date()
    tester.test_get_latest_weight()
    
    # Test NEW reports functionality
    tester.test_reports_week()
    tester.test_reports_month()
    tester.test_reports_year()
    
    # Test NEW water streak functionality
    tester.test_water_streak()
    
    # Test NEW AI coach functionality
    tester.test_coach_tips()
    
    # Test summary endpoint (now includes water and weight)
    tester.test_get_summary()
    
    # Print final results
    print("\n" + "=" * 60)
    print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} passed")
    success_rate = (tester.tests_passed / tester.tests_run) * 100 if tester.tests_run > 0 else 0
    print(f"📈 Success Rate: {success_rate:.1f}%")
    
    if tester.tests_passed == tester.tests_run:
        print("🎉 All tests passed!")
        return 0
    else:
        print("⚠️  Some tests failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())