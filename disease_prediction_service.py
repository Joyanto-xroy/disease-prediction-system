#!/usr/bin/env python3
"""
Disease Prediction Service using Machine Learning
Runs as a local Flask API that the web app calls for disease prediction
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
import json
import os
import traceback

app = Flask(__name__)
CORS(app)

# Load the trained machine learning model for heart disease
ML_MODEL_PATH = os.path.join(os.path.dirname(__file__), 'ml_model', 'heart_disease_model.joblib')
try:
    heart_model = joblib.load(ML_MODEL_PATH)
    print(f"✅ Successfully loaded Heart Disease ML model from {ML_MODEL_PATH}")
except Exception as e:
    heart_model = None
    print(f"⚠️ Warning: Could not load ML model at {ML_MODEL_PATH}: {e}")

# Disease symptom mapping and knowledge base
SYMPTOM_KEYWORDS = {
    # Respiratory
    'Influenza': ['flu', 'influenza', 'cough', 'sore throat', 'body ache', 'myalgia', 'fever'],
    'COVID-19': ['covid', 'coronavirus', 'loss of smell', 'anosmia', 'loss of taste', 'ageusia'],
    'Pneumonia': ['pneumonia', 'chest pain', 'productive cough', 'crackles', 'consolidation'],
    'Bronchitis': ['bronchitis', 'cough', 'phlegm', 'wheezing', 'sputum'],
    'Asthma': ['asthma', 'wheezing', 'dyspnea', 'shortness of breath', 'wheeze'],
    'Common Cold': ['cold', 'runny nose', 'nasal congestion', 'sneezing', 'mild cough'],
    
    # Cardiovascular
    'Hypertension': ['hypertension', 'high bp', 'blood pressure', 'systolic >140', 'diastolic >90'],
    'Heart Disease': ['cardiac', 'heart', 'myocardial', 'infarction', 'MI', 'troponin', 'chest pain', 'ECG abnormality'],
    'Myocardial Infarction': ['MI', 'heart attack', 'acute coronary', 'troponin', 'ST elevation'],
    
    # Endocrine
    'Diabetes': ['diabetes', 'blood sugar', 'glucose', 'insulin', 'HbA1c', 'hyperglycemia', 'fasting glucose'],
    'Hyperthyroidism': ['hyperthyroid', 'TSH', 'tremor', 'weight loss', 'anxiety', 'tachycardia'],
    'Hypothyroidism': ['hypothyroid', 'TSH', 'fatigue', 'weight gain', 'bradycardia'],
    
    # Gastrointestinal
    'Gastroenteritis': ['gastroenteritis', 'diarrhea', 'vomiting', 'nausea', 'stomach cramps'],
    'Peptic Ulcer': ['peptic ulcer', 'stomach pain', 'abdominal pain', 'dyspepsia', 'heartburn'],
    'Appendicitis': ['appendicitis', 'right lower quadrant pain', 'McBurney point', 'acute abdomen'],
    
    # Urinary
    'UTI': ['uti', 'urinary tract infection', 'dysuria', 'frequency', 'urgency', 'pyuria'],
    'Kidney Disease': ['kidney', 'renal', 'creatinine', 'BUN', 'proteinuria', 'hematuria'],
    
    # Dermatologic
    'Skin Infection': ['skin', 'infection', 'dermatitis', 'rash', 'pustule', 'erythema', 'bacterial'],
    'Eczema': ['eczema', 'itching', 'dermatitis', 'rash', 'skin eruption'],
    
    # Hematologic
    'Anemia': ['anemia', 'hemoglobin', 'hb <10', 'pallor', 'fatigue', 'dyspnea'],
    'Thrombocytopenia': ['thrombocytopenia', 'low platelets', 'bleeding', 'bruising', 'petechiae'],
    
    # Infectious
    'Malaria': ['malaria', 'fever', 'chills', 'sweating', 'headache', 'paroxysmal fever'],
    'Tuberculosis': ['TB', 'tuberculosis', 'persistent cough', 'hemoptysis', 'night sweats'],
    'Hepatitis': ['hepatitis', 'jaundice', 'elevated liver enzymes', 'ALT', 'AST', 'bilirubin'],
    
    # Neurological
    'Migraine': ['migraine', 'headache', 'throbbing', 'photophobia', 'nausea', 'vomiting'],
    'Stroke': ['stroke', 'CVA', 'weakness', 'facial drooping', 'speech difficulty', 'aphasia'],
    'Seizure': ['seizure', 'epilepsy', 'convulsion', 'loss of consciousness', 'muscle spasm'],
    
    # Musculoskeletal
    'Arthritis': ['arthritis', 'joint pain', 'swelling', 'stiffness', 'reduced mobility'],
    'Back Pain': ['back pain', 'lumbar pain', 'radiculopathy', 'sciatica'],
}

# Test result keywords
TEST_KEYWORDS = {
    'elevated_wbc': ['elevated wbc', 'high wbc', 'leukocytosis', 'wbc >11'],
    'low_hemoglobin': ['low hemoglobin', 'hb <10', 'anemia', 'reduced hb'],
    'high_glucose': ['high glucose', 'hyperglycemia', 'fasting glucose >126'],
    'high_bp': ['high bp', 'systolic >140', 'diastolic >90', 'hypertension'],
    'elevated_creatinine': ['elevated creatinine', 'high creatinine', 'kidney dysfunction'],
    'low_platelets': ['low platelets', 'thrombocytopenia', 'platelets <150'],
    'abnormal_ecg': ['abnormal ecg', 'ST elevation', 'T wave abnormality'],
}

def calculate_disease_probability(symptoms_text, test_results_text):
    """
    Calculate disease probabilities based on symptoms and test results using ML approach
    """
    all_text = (symptoms_text + ' ' + test_results_text).lower()
    disease_scores = {}
    
    # Score each disease based on keyword matches and weights
    for disease, keywords in SYMPTOM_KEYWORDS.items():
        score = 0
        for keyword in keywords:
            if keyword in all_text:
                score += 1
        
        if score > 0:
            # Weight the score: more specific matches get higher weight
            confidence = min(100, (score / len(keywords)) * 100)
            disease_scores[disease] = confidence
    
    # Add test-based scoring
    for test_indicator, keywords in TEST_KEYWORDS.items():
        for keyword in keywords:
            if keyword in all_text:
                # Boost diseases associated with this test result
                if 'elevated_wbc' in test_indicator or 'low_hemoglobin' in test_indicator:
                    for disease in ['Influenza', 'Pneumonia', 'Anemia', 'UTI', 'Infection']:
                        if disease in disease_scores:
                            disease_scores[disease] *= 1.2
                        else:
                            disease_scores[disease] = 15
                            
                elif 'high_glucose' in test_indicator:
                    disease_scores['Diabetes'] = max(disease_scores.get('Diabetes', 0), 70)
                    
                elif 'high_bp' in test_indicator:
                    disease_scores['Hypertension'] = max(disease_scores.get('Hypertension', 0), 75)
                    
                elif 'abnormal_ecg' in test_indicator:
                    disease_scores['Heart Disease'] = max(disease_scores.get('Heart Disease', 0), 80)
                    
                elif 'elevated_creatinine' in test_indicator:
                    disease_scores['Kidney Disease'] = max(disease_scores.get('Kidney Disease', 0), 70)
    
    # Sort and return top predictions
    sorted_diseases = sorted(disease_scores.items(), key=lambda x: x[1], reverse=True)
    
    return [{
        'disease': disease,
        'confidence': round(score, 2),
        'rank': i + 1
    } for i, (disease, score) in enumerate(sorted_diseases[:5])]

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'service': 'Disease Prediction Service'})

@app.route('/predict', methods=['POST'])
def predict_disease():
    """
    Main prediction endpoint
    Expects: {
        'symptoms': 'string of symptoms',
        'test_results': 'string of test results',
        'diagnosis': 'optional current diagnosis'
    }
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        
        symptoms = data.get('symptoms', '').lower()
        test_results = data.get('test_results', '').lower()
        diagnosis = data.get('diagnosis', '').lower()
        
        if not symptoms:
            return jsonify({'error': 'Symptoms field is required'}), 400
        
        # Calculate predictions
        predictions = calculate_disease_probability(symptoms, test_results + ' ' + diagnosis)
        
        if not predictions:
            return jsonify({
                'message': 'No specific disease pattern detected',
                'predictions': [],
                'recommendation': 'Please provide more detailed clinical information for better prediction'
            }), 200
        
        return jsonify({
            'success': True,
            'predictions': predictions,
            'disclaimer': 'This is an AI-assisted prediction for reference only. Always rely on clinical judgment and proper investigations.',
            'recommendation': f'Top 3 possibilities: {", ".join([p["disease"] for p in predictions[:3]])}'
        }), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/predict_heart_disease', methods=['POST'])
def predict_heart_disease():
    """
    Predicts heart disease risk using the trained Random Forest model.
    Expects JSON containing features: age, sex, cp, trestbps, chol, fbs, restecg, thalach, exang, oldpeak, slope, ca, thal
    """
    if heart_model is None:
        return jsonify({'error': 'Machine learning model is not loaded. Please train the model first.'}), 503

    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No input data provided'}), 400

        # If provided, enforce cardiology-only usage for the ML model
        department = (data.get('department') or '').strip().lower()
        if department and department != 'cardiology':
            return jsonify({'error': 'Heart disease prediction is only supported for the cardiology department.'}), 403

        # Extract features required by the model (using default safe values if missing)
        try:
            features = [
                float(data.get('age', 55)),
                float(data.get('sex', 1)),  # 1=male, 0=female
                float(data.get('cp', 0)),   # Chest pain type (0-3)
                float(data.get('trestbps', 120)), # Resting bp
                float(data.get('chol', 200)),     # Cholesterol
                float(data.get('fbs', 0)),        # Fasting blood sugar > 120 (1 or 0)
                float(data.get('restecg', 0)),    # Resting ECG results (0-2)
                float(data.get('thalach', 150)),  # Max heart rate achieved
                float(data.get('exang', 0)),      # Exercise induced angina (1 or 0)
                float(data.get('oldpeak', 0.0)),  # ST depression induced by exercise
                float(data.get('slope', 2)),      # Slope of peak exercise ST segment (0-2)
                float(data.get('ca', 0)),         # Number of major vessels (0-3)
                float(data.get('thal', 2))        # 1=normal, 2=fixed defect, 3=reversable defect
            ]
        except ValueError as ve:
            return jsonify({'error': f'Invalid numeric input: {str(ve)}'}), 400

        # Convert to numpy array and reshape for single prediction
        features_array = np.array(features).reshape(1, -1)

        # Get probabilities
        probabilities = heart_model.predict_proba(features_array)[0]
        risk_probability = probabilities[1] * 100  # Probability of class 1 (Disease)

        prediction_result = {
            'success': True,
            'risk_percentage': round(risk_probability, 2),
            'has_disease_risk': bool(risk_probability > 50),
            'disclaimer': 'This ML prediction is based on the Cleveland Heart Disease dataset. It is not a substitute for professional medical diagnosis.',
        }
        
        # Add friendly recommendation
        if risk_probability > 75:
            prediction_result['recommendation'] = "High risk pattern detected. Immediate cardiology consultation recommended."
        elif risk_probability > 40:
            prediction_result['recommendation'] = "Moderate risk pattern detected. Recommend further cardiovascular testing (e.g. stress test, echo)."
        else:
            prediction_result['recommendation'] = "Low risk pattern based on current metrics. Standard preventative care recommended."

        return jsonify(prediction_result), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/predict/batch', methods=['POST'])
def predict_batch():
    """
    Batch prediction endpoint for multiple patients
    """
    try:
        data = request.get_json()
        
        if not isinstance(data, list):
            return jsonify({'error': 'Expected array of prediction requests'}), 400
        
        results = []
        for item in data:
            symptoms = item.get('symptoms', '').lower()
            test_results = item.get('test_results', '').lower()
            predictions = calculate_disease_probability(symptoms, test_results)
            
            results.append({
                'patient_id': item.get('patient_id'),
                'predictions': predictions,
                'confidence': predictions[0]['confidence'] if predictions else 0
            })
        
        return jsonify({'success': True, 'results': results}), 200
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/diseases', methods=['GET'])
def get_diseases_list():
    """Get list of all diseases the model can predict"""
    diseases = list(SYMPTOM_KEYWORDS.keys())
    return jsonify({
        'total_diseases': len(diseases),
        'diseases': sorted(diseases)
    }), 200

if __name__ == '__main__':
    print("🏥 Disease Prediction Service Starting...")
    print("📍 API available at http://localhost:5001")
    print("🔗 Endpoints:")
    print("   - Health Check: GET http://localhost:5001/health")
    print("   - ML Cardiology Predict: POST http://localhost:5001/predict_heart_disease")
    print("   - Text-based Predict: POST http://localhost:5001/predict")
    print("   - Batch Predict: POST http://localhost:5001/predict/batch")
    print("   - Diseases List: GET http://localhost:5001/diseases")
    print("\n💡 Make requests from your web app to this service for ML-based predictions\n")
    
    app.run(host='127.0.0.1', port=5001, debug=True)
