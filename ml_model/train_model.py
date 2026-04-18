import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
import joblib
import os

print("Loading dataset from Hugging Face...")
# Load the enhanced heart disease dataset from Hugging Face
df = pd.read_csv("hf://datasets/nezahatkorkmaz/heart-disease-dataset/heart_disease_data_with_features.csv")

print("Dataset loaded. Shape:", df.shape)
print("Columns:", list(df.columns))
print("First few rows:")
print(df.head())

print("Preprocessing data...")
# Check for missing values
print("Missing values:")
print(df.isnull().sum())

# Handle missing values
df = df.dropna()

# Drop string columns that can't be used in ML
string_columns = df.select_dtypes(include=['object']).columns
if len(string_columns) > 0:
    print(f"Dropping string columns: {list(string_columns)}")
    df = df.drop(string_columns, axis=1)

# Check target column name - use 'num' for heart disease
target_col = 'num'
print(f"Using target column: {target_col}")

# Ensure target is binary (0 or 1)
if df[target_col].max() > 1:
    df[target_col] = df[target_col].apply(lambda x: 1 if x > 0 else 0)

# Use the classic heart disease feature set expected by the prediction endpoint
feature_cols = ['age', 'sex', 'cp', 'trestbps', 'chol', 'fbs', 'restecg', 'thalach', 'exang', 'oldpeak', 'slope', 'ca', 'thal']
missing_cols = [col for col in feature_cols if col not in df.columns]
if missing_cols:
    raise ValueError(f"Required feature columns missing from dataset: {missing_cols}")

X = df[feature_cols]
y = df[target_col]
print(f"Using feature columns: {feature_cols}")

print(f"Features shape: {X.shape}")
print(f"Target distribution: {y.value_counts()}")

# Split the dataset
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

print(f"Training set: {X_train.shape[0]} samples")
print(f"Testing set: {X_test.shape[0]} samples")

print("Training Random Forest model...")
# Initialize and train the Random Forest Classifier
clf = RandomForestClassifier(n_estimators=100, random_state=42, max_depth=5)
clf.fit(X_train, y_train)

print("Evaluating model...")
# Predict on test set
y_pred = clf.predict(X_test)

# Calculate accuracy
accuracy = accuracy_score(y_test, y_pred)
print(f"Model Accuracy: {accuracy * 100:.2f}%")
print("\nClassification Report:")
print(classification_report(y_test, y_pred))

# Save the trained model
print("Saving model to heart_disease_model.joblib...")
model_path = os.path.join(os.path.dirname(__file__), 'heart_disease_model.joblib')
joblib.dump(clf, model_path)

print(f"Done. Model saved to {model_path}")
