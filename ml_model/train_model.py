import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report
import joblib
import os

# Define column names for the Cleveland dataset
columns = [
    'age', 'sex', 'cp', 'trestbps', 'chol', 'fbs', 'restecg',
    'thalach', 'exang', 'oldpeak', 'slope', 'ca', 'thal', 'target'
]

print("Loading dataset...")
# Load dataset
df = pd.read_csv('heart.csv', names=columns, na_values='?')

print("Preprocessing data...")
# Handle missing values by dropping rows with NaNs (Cleveland has a few ? values)
df = df.dropna()

# In the Cleveland dataset, target > 0 means heart disease (1,2,3,4) and 0 means no disease.
# We convert this to a binary classification problem: 0 (No Disease), 1 (Disease)
df['target'] = df['target'].apply(lambda x: 1 if x > 0 else 0)

# Separate features and target
X = df.drop('target', axis=1)
y = df['target']

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
