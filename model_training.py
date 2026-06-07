"""
MindGuard-XAI - Model Training (Continuous Risk Scores)
"""

import os
import sys
import pandas as pd
import numpy as np
import joblib
from datetime import datetime
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data', 'processed')
MODEL_DIR = os.path.join(os.path.dirname(__file__), 'models')

os.makedirs(MODEL_DIR, exist_ok=True)

def load_data():
    print("Loading preprocessed data for training...")
    X_train = pd.read_csv(os.path.join(DATA_DIR, 'X_train.csv'))
    X_test = pd.read_csv(os.path.join(DATA_DIR, 'X_test.csv'))
    y_train = pd.read_csv(os.path.join(DATA_DIR, 'y_train.csv')).values.ravel()
    y_test = pd.read_csv(os.path.join(DATA_DIR, 'y_test.csv')).values.ravel()
    return X_train, X_test, y_train, y_test

def train_xgboost_regressor(X_train, y_train, X_test, y_test):
    print("\n=== Training XGBoost Regressor (Continuous Risk 0-100%) ===")
    
    model = XGBRegressor(
        n_estimators=300,
        max_depth=6,
        learning_rate=0.08,
        subsample=0.85,
        colsample_bytree=0.8,
        random_state=42,
        objective='reg:squarederror'
    )

    model.fit(X_train, y_train)
    y_pred = np.clip(model.predict(X_test), 0.0, 1.0)

    results = {
        'mae': float(mean_absolute_error(y_test, y_pred)),
        'r2': float(r2_score(y_test, y_pred)),
        'risk_range': f"{y_pred.min()*100:.1f}% — {y_pred.max()*100:.1f}%"
    }
    print(f"✅ Training Complete! Risk Range: {results['risk_range']}")
    return model, results

def main():
    X_train, X_test, y_train, y_test = load_data()

    # Convert labels to continuous values
    RISK_MAPPING = {'Low': 0.25, 'Medium': 0.62, 'High': 0.88}
    y_train = pd.Series(y_train).map(RISK_MAPPING).fillna(0.3).values
    y_test = pd.Series(y_test).map(RISK_MAPPING).fillna(0.3).values

    model, results = train_xgboost_regressor(X_train, y_train, X_test, y_test)
    
    joblib.dump(model, os.path.join(MODEL_DIR, 'active_model.pkl'))
    print("✅ Continuous risk model saved successfully!")
    return True

if __name__ == "__main__":
    main()

