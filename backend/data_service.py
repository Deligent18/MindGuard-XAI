"""
XAI Risk Sentinel - Data Service Module
Handles student data CRUD operations and batch processing
"""

import os
import json
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional, Any
from fastapi import WebSocket

# Import ML pipeline
from .ml_pipeline import pipeline, MLPipeline


class DataService:
    """
    Service for managing student data and integrating with ML pipeline
    """
    
    def __init__(self):
        self.students_data = []
        self.last_sync = None
        
    # =========================================================================
    # DATA LOADING
    # =========================================================================
    
    def load_students_from_csv(self, file_path: str = None) -> List[Dict]:
        """
        ✓ FIX 4.1: Multi-path search + sample fallback if no CSV
        """
        if file_path is None:
            # ✓ Look in multiple locations (preprocessing output + alternatives)
            possible_paths = [
                os.path.join(os.path.dirname(__file__), "..", "data", "processed", "students.csv"),
                os.path.join(os.path.dirname(__file__), "..", "backend", "data", "students.csv"),
                os.path.join(os.path.dirname(__file__), "data", "students.csv"),
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "students.csv"),
                "data/processed/students.csv",
            ]
            
            file_path = None
            for path in possible_paths:
                if os.path.exists(path):
                    file_path = path
                    break
            
            if file_path is None:
                print("[INFO] No students.csv found - using sample data")
                return self._generate_sample_students()
        
        if not os.path.exists(file_path):
            print(f"[WARNING] CSV file not found: {file_path}")
            return self._generate_sample_students()
        
        df = pd.read_csv(file_path)
        self.last_sync = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        return df.to_dict('records')
    
    def convert_csv_to_student_format(self, csv_data: List[Dict]) -> List[Dict]:
        """
        Convert CSV data format to API student format
        
        CSV columns:
        - student_id, name, programme, year
        - gpa_sem1, gpa_sem2, gpa_sem3
        - attendance, lms_logins, facility_access, library_visits
        - after_hours_wifi, assignment_submissions
        - risk_label
        """
        students = []
        
        for row in csv_data:
            student = {
                "id": row.get('student_id', ''),
                "name": row.get('name', ''),
                "programme": row.get('programme', ''),
                "year": row.get('year', 1),
                "gpa": [g for g in [
                    float(row.get('gpa_sem1', 0) or 0),
                    float(row.get('gpa_sem2', 0) or 0),
                    float(row.get('gpa_sem3', 0) or 0),
                ] if g > 0] or [0.0],  # trim trailing zeros; keep at least one value
                "attendance": row.get('attendance', 0),
                "lmsLogins": row.get('lms_logins', 0),
                "facilityAccess": row.get('facility_access', 0),
                "library_visits": row.get('library_visits', 0),
                "after_hours_wifi": row.get('after_hours_wifi', 0),
                "assignment_submissions": row.get('assignment_submissions', 0),
                "riskLabel": str(row.get('risk_label', 'low')).lower(),
                "shap": [],
                "lime": [],
                "lastUpdated": "",
            }
            # Compute a continuous score from the student features instead of using only the risk_label.
            risk = self.calculate_risk_score(student)
            tier = 'high' if risk >= 0.7 else 'medium' if risk >= 0.4 else 'low'
            student["risk"] = risk
            student["tier"] = tier
            student["explanation"] = (
                f"{student.get('name','This student')} has an estimated {tier} risk score of "
                f"{round(risk*100)}%. Key contributing factors include "
                + ", ".join([c['feature'] for c in self.risk_feature_contributions(student)[:3]])
                + "."
            )
            student["intervention"] = (
                ["Immediate counsellor contact within 24 hours", "Safety planning assessment", "Academic load review"]
                if tier == 'high' else
                ["Proactive welfare check", "Academic support referral"]
                if tier == 'medium' else
                ["Standard wellness newsletter"]
            )
            students.append(student)
        return students
    
    # =========================================================================
    # RISK SCORING
    # =========================================================================

    def calculate_risk_score(self, student: Dict) -> float:
        """Calculate a continuous risk score from student features."""
        gpa = [float(v) for v in student.get('gpa', []) if v is not None]
        current_gpa = gpa[-1] if gpa else 0.0
        previous_gpa = gpa[-2] if len(gpa) > 1 else current_gpa
        gpa_drop = max(0.0, previous_gpa - current_gpa) / 4.0

        attendance = float(student.get('attendance', 0) or 0) / 100.0
        attendance_risk = max(0.0, 0.75 - attendance) / 0.75

        lms = float(student.get('lmsLogins', student.get('lms_logins', 0)) or 0)
        lms_risk = max(0.0, (12.0 - lms) / 18.0)

        facility = float(student.get('facilityAccess', student.get('facility_access', 0)) or 0)
        facility_risk = max(0.0, (6.0 - facility) / 12.0)

        library = float(student.get('library_visits', 0) or 0)
        library_risk = max(0.0, (4.0 - library) / 8.0)

        assignment = float(student.get('assignment_submissions', 0) or 0)
        assignment_risk = max(0.0, (8.0 - assignment) / 12.0)

        score = (
            gpa_drop * 0.38 +
            attendance_risk * 0.28 +
            lms_risk * 0.16 +
            facility_risk * 0.10 +
            library_risk * 0.05 +
            assignment_risk * 0.03
        )
        return float(min(max(score, 0.0), 1.0))

    def risk_feature_contributions(self, student: Dict) -> List[Dict]:
        """Return ranked feature contributions for a risk score."""
        gpa = [float(v) for v in student.get('gpa', []) if v is not None]
        current_gpa = gpa[-1] if gpa else 0.0
        previous_gpa = gpa[-2] if len(gpa) > 1 else current_gpa
        gpa_drop = max(0.0, previous_gpa - current_gpa) / 4.0

        attendance = float(student.get('attendance', 0) or 0) / 100.0
        attendance_risk = max(0.0, 0.75 - attendance) / 0.75

        lms = float(student.get('lmsLogins', student.get('lms_logins', 0)) or 0)
        lms_risk = max(0.0, (12.0 - lms) / 18.0)

        facility = float(student.get('facilityAccess', student.get('facility_access', 0)) or 0)
        facility_risk = max(0.0, (6.0 - facility) / 12.0)

        library = float(student.get('library_visits', 0) or 0)
        library_risk = max(0.0, (4.0 - library) / 8.0)

        assignment = float(student.get('assignment_submissions', 0) or 0)
        assignment_risk = max(0.0, (8.0 - assignment) / 12.0)

        contributions = [
            {
                "feature": "GPA decline",
                "value": round(gpa_drop * 100, 1),
                "dir": 1 if gpa_drop > 0 else -1,
                "weight": round(gpa_drop * 0.38, 4),
            },
            {
                "feature": "Low attendance",
                "value": round((1 - attendance) * 100, 1),
                "dir": 1 if attendance < 0.75 else -1,
                "weight": round(attendance_risk * 0.28, 4),
            },
            {
                "feature": "Low LMS activity",
                "value": round(lms, 1),
                "dir": 1 if lms < 12 else -1,
                "weight": round(lms_risk * 0.16, 4),
            },
            {
                "feature": "Low facility access",
                "value": round(facility, 1),
                "dir": 1 if facility < 6 else -1,
                "weight": round(facility_risk * 0.10, 4),
            },
            {
                "feature": "Low library visits",
                "value": round(library, 1),
                "dir": 1 if library < 4 else -1,
                "weight": round(library_risk * 0.05, 4),
            },
            {
                "feature": "Low assignment submissions",
                "value": round(assignment, 1),
                "dir": 1 if assignment < 8 else -1,
                "weight": round(assignment_risk * 0.03, 4),
            },
        ]
        return sorted(contributions, key=lambda c: abs(c['weight']), reverse=True)

    def _safe_int(self, value: Any, default: int = 0) -> int:
        try:
            if value is None or value == "":
                return default
            return int(value)
        except (ValueError, TypeError):
            return default

    def _safe_float(self, value: Any, default: float = 0.0) -> float:
        try:
            if value is None or value == "":
                return default
            return float(value)
        except (ValueError, TypeError):
            return default

    def manual_assessment(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Run a live risk assessment from manual student feature contributions."""
        student = {
            "name": payload.get("name", "Unknown"),
            "programme": payload.get("programme", ""),
            "year": self._safe_int(payload.get("year", 1), 1),
            "gpa": [v for v in [payload.get("gpa_sem1"), payload.get("gpa_sem2"), payload.get("gpa_sem3")] if isinstance(v, (int, float))],
            "attendance": self._safe_float(payload.get("attendance", 0), 0.0),
            "lmsLogins": self._safe_int(payload.get("lms_logins", payload.get("lmsLogins", 0)), 0),
            "facilityAccess": self._safe_int(payload.get("facility_access", payload.get("facilityAccess", 0)), 0),
            "library_visits": self._safe_float(payload.get("library_visits", 0), 0.0),
            "after_hours_wifi": self._safe_float(payload.get("after_hours_wifi", 0), 0.0),
            "assignment_submissions": self._safe_int(payload.get("assignment_submissions", 0), 0),
        }
        risk = self.calculate_risk_score(student)
        tier = 'high' if risk >= 0.7 else 'medium' if risk >= 0.4 else 'low'
        contributions = self.risk_feature_contributions(student)
        explanation = (
            f"{student['name']} is estimated at {round(risk*100)}% risk ({tier}) based on the top contributing factors: "
            + ", ".join([c['feature'] for c in contributions[:5]]) + "."
        )
        return {
            "name": student["name"],
            "programme": student["programme"],
            "year": student["year"],
            "risk": risk,
            "tier": tier,
            "feature_contributions": contributions,
            "explanation": explanation,
            "lastUpdated": datetime.now().strftime("%Y-%m-%d"),
        }

    def predict_all_students(self, students: List[Dict]) -> List[Dict]:
        """
        Run predictions for all students using ML pipeline
        
        Returns updated student records with risk scores and SHAP values
        """
        # Ensure model is ready
        if not pipeline.is_trained:
            # Try to load existing model
            pipeline.load_model()
            
        if not pipeline.is_trained:
            # Train new model
            df = pipeline.load_data()
            if not df.empty:
                pipeline.train_model(df, save=True)
        
        # Generate predictions for each student
        updated_students = []
        
        for student in students:
            # Convert to ML pipeline format
            student_features = self._to_ml_format(student)
            
            # Get prediction with SHAP
            prediction = pipeline.predict_single(student_features)
            
            # Create updated student record
            updated = {
                "id": student.get('id', ''),
                "name": student.get('name', ''),
                "programme": student.get('programme', ''),
                "year": student.get('year', 1),
                "risk": prediction.get('risk', 0),
                "tier": prediction.get('tier', 'low'),
                "gpa": student.get('gpa', []),
                "attendance": student.get('attendance', 0),
                "lmsLogins": student.get('lmsLogins', 0),
                "facilityAccess": student.get('facilityAccess', 0),
                "shap": prediction.get('shap', []),
                "lime": prediction.get('lime', []),
                "explanation": prediction.get('explanation', ''),
                "intervention": prediction.get('intervention', []),
                "lastUpdated": prediction.get('lastUpdated', '')
            }
            updated_students.append(updated)
        
        return updated_students
    
    def predict_single_student(self, student: Dict) -> Dict:
        """
        Predict risk for a single student
        """
        # Ensure model is ready
        if not pipeline.is_trained:
            pipeline.load_model()
            
        if not pipeline.is_trained:
            return {"error": "Model not trained"}
        
        # Convert to ML format
        student_features = self._to_ml_format(student)
        
        # Get prediction
        prediction = pipeline.predict_single(student_features)
        
        return prediction
    
    def _to_ml_format(self, student: Dict) -> Dict:
        """Convert student API format to ML pipeline format"""
        gpa = student.get('gpa', [0, 0, 0])
        
        return {
            "student_id": student.get('id', ''),
            "name": student.get('name', ''),
            "programme": student.get('programme', ''),
            "year": student.get('year', 1),
            "gpa_sem1": float(gpa[0]) if len(gpa) > 0 else 0.0,
            "gpa_sem2": float(gpa[1]) if len(gpa) > 1 else 0.0,
            "gpa_sem3": float(gpa[2]) if len(gpa) > 2 else 0.0,
            "attendance": student.get('attendance', 0),
            "lms_logins": student.get('lmsLogins', 0),
            "facility_access": student.get('facilityAccess', 0),
            "library_visits": student.get('library_visits', 0),
            "after_hours_wifi": student.get('after_hours_wifi', 0),
            "assignment_submissions": student.get('assignment_submissions', 0),
        }
    
    # =========================================================================
    # BATCH OPERATIONS
    # =========================================================================
    
    def batch_update_predictions(self, students: List[Dict]) -> Dict[str, Any]:
        """
        Batch update predictions for multiple students
        """
        start_time = datetime.now()
        
        try:
            predictions = self.predict_all_students(students)
            
            elapsed = (datetime.now() - start_time).total_seconds()
            
            return {
                "status": "success",
                "processed": len(predictions),
                "predictions": predictions,
                "elapsed_seconds": elapsed,
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e),
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            }
    
    # =========================================================================
    # VALIDATION
    # =========================================================================
    
    def validate_student_data(self, student: Dict) -> Dict[str, Any]:
        """Validate student data completeness"""
        required_fields = ['id', 'name', 'programme', 'year']
        optional_fields = ['gpa', 'attendance', 'lmsLogins', 'facilityAccess']
        
        missing = [f for f in required_fields if f not in student or not student[f]]
        
        validation = {
            "valid": len(missing) == 0,
            "missing_fields": missing,
            "warnings": []
        }
        
        # Check for data quality issues
        if 'gpa' in student:
            gpa = student['gpa']
            if any(g > 4.0 or g < 0 for g in gpa if g):
                validation["warnings"].append("GPA values should be between 0 and 4.0")
                
        if 'attendance' in student:
            if student['attendance'] > 100 or student['attendance'] < 0:
                validation["warnings"].append("Attendance should be between 0 and 100")
        
        return validation


# Global data service instance
data_service = DataService()


# =============================================================================
# HELPER FUNCTIONS FOR SERVER.PY INTEGRATION
# =============================================================================

def get_student_by_id(student_id: str, students_list: List[Dict]) -> Optional[Dict]:
    """Get a student by ID from list"""
    for student in students_list:
        if student.get('id') == student_id:
            return student
    return None


def update_student_in_list(student_id: str, updates: Dict, students_list: List[Dict]) -> Optional[Dict]:
    """Update a student in list and return updated student"""
    for i, student in enumerate(students_list):
        if student.get('id') == student_id:
            students_list[i].update(updates)
            return students_list[i]
    return None


def filter_by_tier(students: List[Dict], tier: str) -> List[Dict]:
    """Filter students by risk tier"""
    return [s for s in students if s.get('tier') == tier]


def get_statistics(students: List[Dict]) -> Dict[str, Any]:
    """Calculate student statistics"""
    total = len(students)
    high = len([s for s in students if s.get('tier') == 'high'])
    medium = len([s for s in students if s.get('tier') == 'medium'])
    low = len([s for s in students if s.get('tier') == 'low'])
    
    avg_risk = 0
    if total > 0:
        avg_risk = sum(s.get('risk', 0) for s in students) / total
    
    return {
        "total": total,
        "high_risk": high,
        "medium_risk": medium,
        "low_risk": low,
        "average_risk": round(avg_risk, 3)
    }


if __name__ == "__main__":
    # Test the data service
    print("Testing Data Service...")
    
    # Load students
    students = data_service.load_students_from_csv()
    print(f"Loaded {len(students)} students")
    
    if students:
        # Convert format
        api_students = data_service.convert_csv_to_student_format(students)
        print(f"Converted to API format: {len(api_students)} students")
        
        # Run predictions
        predictions = data_service.predict_all_students(api_students)
        print(f"Generated predictions for {len(predictions)} students")
        
        # Show sample
        if predictions:
            print(f"\nSample prediction:")
            print(f"  Student: {predictions[0].get('name')}")
            print(f"  Risk: {predictions[0].get('risk')}")
            print(f"  Tier: {predictions[0].get('tier')}")
