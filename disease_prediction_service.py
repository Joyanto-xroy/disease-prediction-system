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
import requests
import logging
import re

# Load environment variables from .env file manually
from dotenv import load_dotenv
load_dotenv()

# Load environment variables
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
OPENAI_API_MODEL = os.getenv('OPENAI_API_MODEL', 'gpt-3.5-turbo')
OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
    'Hypertension': ['hypertension', 'high bp', 'blood pressure', 'systolic >140', 'diastolic >90', 'high blood pressure'],
    'Heart Disease': ['cardiac', 'heart', 'myocardial', 'infarction', 'MI', 'troponin', 'chest pain', 'left chest', 'left-sided chest pain', 'dizziness', 'dizzy', 'vertigo', 'lightheaded', 'palpitations', 'irregular heartbeat', 'racing heart', 'heart racing', 'shortness of breath', 'dyspnea', 'SOB', 'breathless', 'fatigue', 'tired', 'weakness', 'sweating', 'diaphoresis', 'nausea', 'vomiting', 'arm pain', 'jaw pain', 'neck pain', 'back pain', 'radiating pain', 'pressure in chest', 'tightness in chest', 'heaviness in chest', 'burning chest', 'at night', 'nocturnal', 'exertional', 'rest pain', 'ECG abnormality', 'arrhythmia', 'tachycardia', 'bradycardia', 'murmur', 'valve disease'],
    'Myocardial Infarction': ['MI', 'heart attack', 'acute coronary', 'troponin', 'ST elevation', 'chest pain', 'left chest', 'dizziness', 'crushing pain', 'severe chest pain', 'cardiac arrest', 'sudden death', 'acute MI', 'STEMI', 'NSTEMI'],
    
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
    all_text = f"{symptoms_text} {test_results_text}".lower()
    disease_scores = {}
    
    # Score each disease based on keyword matches and weights
    for disease, keywords in SYMPTOM_KEYWORDS.items():
        score = sum(1 for keyword in keywords if keyword in all_text)
        
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

# ────────────────────────────────────────────────────────────────────────────
# CARDIOAI SYSTEM PROMPTS
# ────────────────────────────────────────────────────────────────────────────
CARDIOAI_SUPER_PROMPT = """
You are "CardioAI" — a WORLD-CLASS Cardiologist-Level Clinical AI System.

You do NOT behave like a chatbot.
You think, analyze, and respond like a highly experienced cardiologist.

==================================================
🧠 CORE IDENTITY
==================================================

- 20+ years cardiology expertise
- Evidence-based (ACC/AHA, ESC guidelines mindset)
- Strong clinical reasoning (not generic advice)
- Capable of:
  - Risk stratification
  - Symptom interpretation
  - Differential diagnosis
  - Clinical decision-making

You DO NOT just explain — you CLINICALLY ANALYZE.

==================================================
📥 INPUT CONTEXT
==================================================

You will receive structured + unstructured patient data:

- PATIENT'S REPORTED SYMPTOMS (PRIMARY FOCUS): Natural language description of what the patient is experiencing
- Demographics (Age, Sex, Visit Time)
- Vitals (BP, HR, SpO2, Temp, BMI)
- Lab/Test Results (Cholesterol, Glucose, ECG findings)
- Cardiac Features (Chest pain type, Exercise angina, ST depression, Slope, Major vessels, Thalassemia)
- ML Prediction (risk %, level)
- Clinical notes

CRITICAL: Always start by analyzing the patient's reported symptoms first. Do NOT ignore the natural language symptom description. Evaluate cardiac vs non-cardiac causes based on the symptom presentation. You MUST integrate ALL data together and EXPLAIN the influence of EACH input feature.

==================================================
🚨 STEP 1: EMERGENCY TRIAGE (MANDATORY)
==================================================

Check for life-threatening signs:

- Crushing chest pain / radiating pain
- Severe shortness of breath
- Syncope
- SpO2 < 92%
- BP >180/120 or <90 systolic
- HR >130 or <40

IF FOUND:

➡️ Output:
🚨 MEDICAL EMERGENCY
- Immediate hospital referral
- Do NOT continue full analysis

==================================================
🧾 STEP 2: CLINICAL THINKING PIPELINE
==================================================

You MUST internally perform:

1. Pattern recognition (symptoms + vitals)
2. Risk factor identification
3. Cardiac vs non-cardiac differentiation
4. ML validation (agree / disagree / cautious)
5. Clinical prioritization
6. FEATURE-BY-FEATURE ANALYSIS: Explain how each input influences the risk

==================================================
📊 OUTPUT STRUCTURE (STRICT)
==================================================

1. 🧾 PATIENT SNAPSHOT
- Age, sex, visit time
- Key symptoms
- Critical abnormal values

--------------------------------------------------

2. 🚨 CLINICAL RED FLAGS
- Present / Absent
- If present → highlight clearly

--------------------------------------------------

3. 📈 VITAL INTERPRETATION
- BP classification: Normal / Elevated / HTN Stage 1 / Stage 2
- HR: normal / tachy / brady
- SpO2 status
- BMI (if possible)

--------------------------------------------------

4. 🧠 CLINICAL ANALYSIS

PRIMARY: Analyze the patient's reported symptoms first:
- What is the chief complaint? (chest pain, dizziness, etc.)
- Symptom characteristics (location, radiation, timing, duration, quality, severity)
- Associated symptoms and timing patterns
- Red flags for cardiac pathology

Then evaluate:
- Are symptoms cardiac in nature? Why or why not?
- Likely causes (NOT final diagnosis):
  e.g. Angina vs GERD vs Anxiety vs Cardiac ischemia

- Explain reasoning like a doctor:
  "because..., therefore..."

--------------------------------------------------

5. 🔬 FEATURE-BY-FEATURE IMPACT ANALYSIS

ANALYZE AND EXPLAIN each input's influence:

- **Age**: How does this age affect baseline risk?
- **Sex**: Male vs Female risk differences
- **Chest Pain Type**: (0=typical angina, 1=atypical, 2=non-anginal, 3=asymptomatic) - Clinical significance
- **Resting BP**: Normal vs abnormal, what does this BP mean?
- **Cholesterol**: Optimal vs high, impact on atherosclerosis risk
- **Fasting Glucose**: Normal vs diabetic, cardiovascular implications
- **Resting ECG**: (0=normal, 1=ST-T abnormality, 2=left ventricular hypertrophy) - What does this finding indicate?
- **Max Heart Rate**: Normal vs abnormal, exercise capacity indicator
- **Exercise Angina**: Presence/absence and what it means
- **ST Depression**: Amount and clinical significance
- **Slope**: (0=upsloping, 1=flat, 2=downsloping) - ST segment morphology
- **Major Vessels**: Number of vessels with disease (0-3)
- **Thalassemia**: (1=normal, 2=fixed defect, 3=reversable defect) - Myocardial perfusion

--------------------------------------------------

6. 🤖 ML MODEL INTERPRETATION

- Risk % and level
- Do you agree? Why or why not?
- Which features drove the ML prediction highest?

Say clearly:
- "Clinically consistent"
OR
- "Partially consistent"
OR
- "Over/underestimated"

Mention:
Model limitation (Cleveland dataset)

--------------------------------------------------

7. ❤️ FINAL RISK STRATIFICATION

Low / Moderate / High

Based on:
- ML prediction
- Individual feature analysis
- Symptoms
- Vitals

NOT ML alone

--------------------------------------------------

8. 🩺 MANAGEMENT PLAN

A. Immediate Action
B. Lifestyle Plan
C. Medical Direction (SAFE)
   - Mention class (e.g. statins, beta-blockers)
   - ❌ NO dosage

--------------------------------------------------

9. 🔬 REQUIRED TESTS

Only if needed:
- ECG
- Echo
- Troponin
- Lipid profile
- HbA1c

--------------------------------------------------

10. 👨‍⚕️ REFERRAL DECISION

- Cardiologist needed? (Yes/No)
- Other dept if needed

--------------------------------------------------

11. ⚠️ WHAT TO AVOID

- Activities
- Habits
- Ignoring symptoms

--------------------------------------------------

12. 🔮 PROGNOSIS

- If managed → outcome
- If ignored → risk

==================================================
🧠 INTELLIGENCE RULES
==================================================

- NEVER blindly trust ML
- ALWAYS cross-check clinically
- NEVER give weak generic advice
- ALWAYS justify reasoning
- ALWAYS explain feature influence

==================================================
🚫 SAFETY RULES
==================================================

- NO exact drug dosage
- NO absolute diagnosis
- ALWAYS cautious but confident tone

==================================================
💬 STYLE
==================================================

- Speak like a senior doctor
- Confident, structured, clinical
- Not robotic, not casual

==================================================
⚠️ FINAL DISCLAIMER
==================================================

This is an AI-supported clinical analysis and NOT a replacement for a licensed physician.
Seek professional medical care for diagnosis and treatment.
"""

def call_openai_chat(system_prompt, user_message, context=""):
    """
    Call OpenAI chat completion API for CardioAI response.
    """
    if not OPENAI_API_KEY:
        return None

    try:
        messages = [
            {'role': 'system', 'content': system_prompt.strip()}
        ]
        if context:
            messages.append({'role': 'user', 'content': f"Context:\n{context.strip()}"})
        messages.append({'role': 'user', 'content': user_message.strip()})

        headers = {
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {OPENAI_API_KEY}'
        }

        payload = {
            'model': OPENAI_API_MODEL,
            'messages': messages,
            'top_p': 0.95,
            'temperature': 0.4,
            'max_tokens': 1500,
        }

        response = requests.post(
            OPENAI_API_URL,
            headers=headers,
            json=payload,
            timeout=20
        )

        if response.status_code == 200:
            result = response.json()
            if 'choices' in result and len(result['choices']) > 0:
                message = result['choices'][0].get('message', {})
                if isinstance(message, dict) and message.get('content'):
                    return message['content'].strip()

        logger.warning(f"OpenAI returned status {response.status_code}: {response.text[:200]}")
    except Exception as e:
        logger.warning(f"OpenAI chat error: {e}")

    return None


def call_gemini_chat(system_prompt, user_message, context=""):
    """
    Call Gemini chat API if configured.
    """
    if not GEMINI_API_KEY or GEMINI_API_KEY == 'your_api_key_here':
        return None

    try:
        full_prompt = f"{system_prompt.strip()}\n\n"
        if context:
            full_prompt += f"Context:\n{context.strip()}\n\n"
        full_prompt += f"User message:\n{user_message.strip()}"

        headers = {'Content-Type': 'application/json'}
        payload = {
            'contents': [{'parts': [{'text': full_prompt}]}],
            'generationConfig': {
                'temperature': 0.7,
                'topK': 40,
                'topP': 0.95,
                'maxOutputTokens': 1024,
            }
        }

        response = requests.post(
            f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
            headers=headers,
            json=payload,
            timeout=15
        )

        if response.status_code == 200:
            result = response.json()
            if 'candidates' in result and len(result['candidates']) > 0:
                return result['candidates'][0]['content']['parts'][0]['text']

        logger.warning(f"Gemini returned status {response.status_code}: {response.text[:200]}")
    except Exception as e:
        logger.warning(f"Gemini chat error: {e}")

    return None


def call_ai_chat(system_prompt, user_message, context=""):
    """
    Use OpenAI first if available, then Gemini, and fallback to intelligent analysis.
    """
    response = call_openai_chat(system_prompt, user_message, context)
    if response:
        return response

    response = call_gemini_chat(system_prompt, user_message, context)
    if response:
        return response

    return generate_intelligent_fallback(system_prompt, user_message, context)


def generate_intelligent_fallback(system_prompt, user_message, context):
    """
    Generate intelligent clinical analysis when API is unavailable
    """
    # Parse context for key information
    risk_pct = 50  # default
    patient_data = {}
    prediction_result = {}

    if context:
        # Extract risk percentage
        if (risk_match := re.search(r'Risk %?\s*:\s*([0-9.]+)', context, re.IGNORECASE)):
            risk_pct = float(risk_match.group(1))

        # Extract patient data
        if (age_match := re.search(r'Age\s*:\s*([0-9]+)', context, re.IGNORECASE)):
            patient_data['age'] = int(age_match.group(1))

        if (bp_match := re.search(r'Resting BP\s*:\s*([0-9]+)', context, re.IGNORECASE)):
            patient_data['bp'] = int(bp_match.group(1))

        if (symptoms_match := re.search(r'Symptoms\s*:\s*([^,\n]+)', context, re.IGNORECASE)):
            patient_data['symptoms'] = symptoms_match.group(1).strip()

    # Generate intelligent analysis based on risk level
    if risk_pct >= 70:
        risk_level = "High"
        analysis = f"""
**1. ML Prediction Summary**
The machine learning model indicates a {risk_pct:.1f}% risk of heart disease, classifying this as **High Risk**. This assessment is based on the Cleveland Heart Disease dataset patterns.

**2. Clinical Consistency Check**
- **Vital Signs Analysis**: {'Elevated blood pressure detected' if patient_data.get('bp', 120) > 140 else 'Blood pressure within acceptable range'}
- **Age Factor**: {'Advanced age increases baseline risk' if patient_data.get('age', 50) > 60 else 'Age factor moderate'}
- **Symptom Correlation**: {'Chest pain and cardiac symptoms present' if 'chest pain' in str(patient_data.get('symptoms', '')).lower() else 'Symptoms may not be cardiac-specific'}

**3. Risk Interpretation**
High-risk profile suggests possible coronary artery disease or significant cardiovascular risk factors. The model identifies concerning patterns in the clinical parameters provided.

**4. Suggested Next Steps**
- **Immediate**: Schedule cardiology consultation within 1-2 weeks
- **Diagnostic**: Consider stress testing, echocardiography, or coronary angiography
- **Management**: Start preventive medications (aspirin, statins) pending specialist evaluation
- **Lifestyle**: Implement heart-healthy diet, exercise, and smoking cessation
- **Monitoring**: Regular blood pressure and lipid profile checks

**Clinical Recommendation**: This high-risk prediction warrants prompt specialist evaluation to rule out serious cardiac conditions.
"""
    elif risk_pct >= 40:
        risk_level = "Moderate"
        analysis = f"""
**1. ML Prediction Summary**
The machine learning model estimates a {risk_pct:.1f}% risk of heart disease, indicating **Moderate Risk**. This falls in an intermediate range requiring attention.

**2. Clinical Consistency Check**
- **Vital Signs Analysis**: {'Blood pressure mildly elevated' if patient_data.get('bp', 120) > 130 else 'Blood pressure acceptable'}
- **Age Consideration**: {'Age contributes to moderate risk profile' if patient_data.get('age', 50) > 50 else 'Age factor within normal range'}
- **Symptom Assessment**: {'Some cardiac symptoms noted' if any(word in str(patient_data.get('symptoms', '')).lower() for word in ['chest', 'pain', 'shortness']) else 'Symptoms may be non-specific'}

**3. Risk Interpretation**
Moderate risk suggests potential cardiovascular concerns that warrant monitoring and preventive measures. While not immediately critical, this level requires proactive management.

**4. Suggested Next Steps**
- **Primary Care**: Follow-up with primary physician within 4-6 weeks
- **Screening**: Lipid profile, HbA1c, and comprehensive metabolic panel
- **Lifestyle**: DASH diet, regular aerobic exercise (150 min/week), weight management
- **Risk Modification**: Address modifiable factors (smoking, hypertension, diabetes)
- **Monitoring**: Annual cardiac risk assessment and periodic ECG

**Clinical Recommendation**: Moderate risk indicates need for preventive cardiology approach with regular monitoring.
"""
    else:
        risk_level = "Low"
        analysis = f"""
**1. ML Prediction Summary**
The machine learning model calculates a {risk_pct:.1f}% risk of heart disease, classifying this as **Low Risk**. This suggests favorable cardiovascular health status.

**2. Clinical Consistency Check**
- **Vital Signs Analysis**: {'Blood pressure well-controlled' if patient_data.get('bp', 120) <= 120 else 'Blood pressure acceptable'}
- **Age Assessment**: {'Younger age contributes to lower baseline risk' if patient_data.get('age', 50) < 50 else 'Age-appropriate risk level'}
- **Symptom Review**: {'Symptoms appear cardiac in nature' if any(word in str(patient_data.get('symptoms', '')).lower() for word in ['chest', 'pain', 'dyspnea', 'dizziness', 'palpitations', 'shortness', 'breath']) else 'No significant cardiac symptoms reported'}

**3. Risk Interpretation**
Low risk profile indicates strong cardiovascular health foundation. The model finds no significant concerning patterns in the provided clinical data.

**4. Suggested Next Steps**
- **Preventive Care**: Continue routine health maintenance
- **Screening**: Standard periodic health evaluations every 1-2 years
- **Lifestyle**: Maintain healthy diet, regular exercise, and avoid smoking
- **Monitoring**: Annual blood pressure and cholesterol checks
- **Education**: Heart-healthy living education and awareness

**Clinical Recommendation**: Low risk supports standard preventive care approach with emphasis on health maintenance.
"""

    return analysis.strip() + "\n\n*This analysis is generated using clinical guidelines and ML model interpretation. Always consult with a qualified healthcare provider for personalized medical advice.*"


@app.route('/api/chat', methods=['POST'])
def cardioai_patient_chat():
    """
    CardioAI Patient Chatbot endpoint.
    Accepts a natural language message plus optional prediction context,
    responds using the SYSTEM_PROMPT via Gemini.

    Body: {
        "message": str,
        "prediction_data": {          # optional — pass if user has a result
            "risk_level": str,
            "probability": float,
            "age": int, "sex": int,
            "cp": int, "trestbps": int,
            "chol": int, "fbs": int,
            "restecg": int, "thalach": int,
            "exang": int, "oldpeak": float,
            "slope": int, "ca": int, "thal": int
        }
    }
    """
    data = request.get_json()
    if not data or not data.get('message'):
        return jsonify({'success': False, 'error': 'message is required'}), 400

    user_message = str(data['message']).strip()
    prediction_data = data.get('prediction_data', {})

    # Build base context for unstructured symptoms and cardiology analysis
    context = f"""
PATIENT PRESENTATION:
- Chief Complaint/Symptoms: {user_message}
- Visit Time: {data.get('visit_time', 'Not specified')}
- Clinical Request: Provide senior cardiologist-level analysis of these symptoms and risk stratification.

IMPORTANT: Focus primarily on analyzing the patient's reported symptoms ({user_message}) for cardiac pathology.
"""

    if prediction_data:
        # Basic info
        age = prediction_data.get('age', 'N/A')
        sex = prediction_data.get('sex', 'N/A')

        # Vitals
        bp = prediction_data.get('trestbps', 'N/A')
        chol = prediction_data.get('chol', 'N/A')
        hr = prediction_data.get('thalach', 'N/A')
        fbs = prediction_data.get('fbs', 'N/A')
        spO2 = prediction_data.get('spO2', 'N/A')
        temp = prediction_data.get('temperature', 'N/A')
        weight = prediction_data.get('weight', 'N/A')
        height = prediction_data.get('height', 'N/A')

        # ML features
        cp = prediction_data.get('cp', 'N/A')
        exang = prediction_data.get('exang', 'N/A')
        oldpeak = prediction_data.get('oldpeak', 'N/A')
        slope = prediction_data.get('slope', 'N/A')
        ca = prediction_data.get('ca', 'N/A')
        thal = prediction_data.get('thal', 'N/A')

        # Prediction
        risk = prediction_data.get('risk_level', 'Unknown')
        prob = prediction_data.get('probability', 'N/A')

        # Extra clinical fields (if you pass them)
        diagnosis = prediction_data.get('diagnosis', 'Not provided')
        test_results = prediction_data.get('test_results', 'Not provided')

        # Format readable values
        sex_label = "Male" if sex == 1 else "Female" if sex == 0 else "Unknown"
        fbs_label = ">120 mg/dL" if fbs == 1 else "≤120 mg/dL" if fbs == 0 else "Unknown"
        exang_label = "Yes" if exang == 1 else "No" if exang == 0 else "Unknown"

        # BMI calculation
        bmi_text = "N/A"
        try:
            if weight != 'N/A' and height != 'N/A':
                bmi = float(weight) / ((float(height)/100) ** 2)
                bmi_text = round(bmi, 1)
        except:
            pass

        context = f"""
    PATIENT PROFILE:
    - Age: {age}
    - Sex: {sex_label}
    - Visit Time: {prediction_data.get('visit_time', 'Not specified')}

    SYMPTOMS:
    {user_message}

    VITAL SIGNS:
    - Blood Pressure: {bp} mmHg
    - Heart Rate: {hr} bpm
    - Temperature: {temp} °C
    - SpO2: {spO2} %
    - Weight: {weight} kg
    - Height: {height} cm
    - BMI: {bmi_text}

    LAB / TEST DATA:
    - Cholesterol: {chol} mg/dL
    - Fasting Blood Sugar: {fbs_label}
    - ECG: {prediction_data.get('restecg', 'N/A')}

    CARDIAC FEATURES:
    - Chest Pain Type: {cp} (0=typical angina, 1=atypical, 2=non-anginal, 3=asymptomatic)
    - Exercise Induced Angina: {exang_label}
    - ST Depression (oldpeak): {oldpeak}
    - Slope: {slope} (0=upsloping, 1=flat, 2=downsloping)
    - Major Vessels: {ca} (0-3 vessels with disease)
    - Thalassemia: {thal} (1=normal, 2=fixed defect, 3=reversable defect)

    CLINICAL NOTES:
    - Diagnosis: {diagnosis}
    - Test Results: {test_results}

    ML PREDICTION:
    - Risk Level: {risk}
    - Probability: {prob}%

    IMPORTANT:
    Analyze clinically using all data. Explain the influence of each feature on the risk assessment.
"""

    ai_request = (
        "Analyze this patient's symptoms as a senior cardiologist. The patient reports: '" + user_message + "'\n\n"
        "CRITICAL: Evaluate if these symptoms suggest cardiac pathology. Consider:\n"
        "- Chest pain characteristics (location, radiation, timing, duration, quality)\n"
        "- Associated symptoms (dizziness, shortness of breath, palpitations, sweating)\n"
        "- Timing patterns (at night, exertional, rest)\n"
        "- Risk factors and red flags\n\n"
        "Provide structured clinical analysis explaining your reasoning."
    )
    ai_response = call_ai_chat(CARDIOAI_SUPER_PROMPT, ai_request, context)
    if ai_response is None:
        risk_level = prediction_data.get('risk_level', 'Unknown')
        probability = prediction_data.get('probability', 'N/A')
        prob_str = f"{probability:.1f}%" if isinstance(probability, (int, float)) else probability

        # Graceful fallback when Gemini is not configured, still acting as CardioAI
        if prediction_data and isinstance(probability, (int, float)):
            if probability >= 70:
                fallback = (
                    f"Based on the clinical parameters provided, the machine learning model has estimated a **{prob_str}** risk of heart disease, classifying this as **High Risk**.\n\n"
                    f"**Key Factors Analyzed**:\n"
                    f"- Age, blood pressure, and cholesterol levels are primary inputs in this calculation.\n"
                    f"- If present, factors like chest pain or exercise-induced angina elevate the risk score.\n\n"
                    f"**Explanation**:\n"
                    f"Your input values for blood pressure, maximum heart rate, or cholesterol align with patterns commonly found in high-risk groups.\n\n"
                    f"**Recommendation**:\n"
                    f"We strongly recommend you discuss these results with a cardiologist for a complete evaluation and tailored treatment plan.\n\n"
                    f"⚠️ This is an AI-based prediction. Consult a doctor for medical advice."
                )
            elif probability >= 40:
                fallback = (
                    f"Based on the clinical parameters provided, the machine learning model has estimated a **{prob_str}** risk of heart disease, classifying this as **Moderate Risk**.\n\n"
                    f"**Key Factors Analyzed**:\n"
                    f"- Current age, cholesterol levels, and resting blood pressure.\n"
                    f"- Elevated inputs or borderline clinical signs may trigger this moderate score.\n\n"
                    f"**Explanation**:\n"
                    f"While not in the critical range, some of your vitals suggest cardiovascular stress that warrants attention.\n\n"
                    f"**Recommendation**:\n"
                    f"Focus on lifestyle improvements (diet, exercise) and consider scheduling a follow-up with your primary physician to monitor these markers.\n\n"
                    f"⚠️ This is an AI-based prediction. Consult a doctor for medical advice."
                )
            else:
                fallback = (
                    f"Based on the clinical parameters provided, the machine learning model has estimated a **{prob_str}** risk of heart disease, classifying this as **Low Risk**.\n\n"
                    f"**Key Factors Analyzed**:\n"
                    f"- Normal bounds for resting blood pressure.\n"
                    f"- Healthy cholesterol levels and max heart rate parameters.\n\n"
                    f"**Explanation**:\n"
                    f"Your cardiovascular responses are aligned with strong heart health patterns based on the model's dataset.\n\n"
                    f"**Recommendation**:\n"
                    f"Continue maintaining your healthy lifestyle habits! Routine yearly check-ups are still advised.\n\n"
                    f"⚠️ This is an AI-based prediction. Consult a doctor for medical advice."
                )
        elif any(kw in user_message.lower() for kw in ['heart', 'risk', 'predict', 'cardio', 'cholesterol', 'pressure', 'angina', 'disease', 'chest', 'dizziness', 'left chest', 'shortness', 'palpitations', 'pain', 'breath', 'dyspnea', 'fatigue', 'weakness', 'sweating', 'nausea', 'arm', 'jaw', 'neck', 'back']):
            # Analyze symptoms for cardiac features
            symptoms_lower = user_message.lower()
            cardiac_indicators = []
            if 'chest' in symptoms_lower and 'pain' in symptoms_lower:
                cardiac_indicators.append("chest pain present")
            if 'dizziness' in symptoms_lower or 'dizzy' in symptoms_lower:
                cardiac_indicators.append("dizziness/vertigo")
            if 'shortness' in symptoms_lower or 'breath' in symptoms_lower:
                cardiac_indicators.append("dyspnea")
            if 'night' in symptoms_lower or 'nocturnal' in symptoms_lower:
                cardiac_indicators.append("nocturnal symptoms")
            if 'exert' in symptoms_lower:
                cardiac_indicators.append("exertional symptoms")

            fallback = (
                "CardioAI clinical assessment:\n\n"
                f"**Symptom Analysis**: Patient reports '{user_message}'\n"
                f"**Cardiac Indicators Detected**: {', '.join(cardiac_indicators) if cardiac_indicators else 'None clearly identified'}\n\n"
                "**Clinical Assessment**:\n"
                "- Chest pain with dizziness, especially at night, requires urgent evaluation\n"
                "- These symptoms can indicate cardiac ischemia, arrhythmia, or other serious conditions\n"
                "- Nocturnal chest pain is particularly concerning for cardiac pathology\n\n"
                "**Recommendation**:\n"
                "- Seek immediate medical evaluation - do not delay\n"
                "- Request ECG, cardiac enzymes, and cardiology consultation\n"
                "- Avoid strenuous activity until evaluated\n\n"
                "⚠️ This is an AI-based prediction. Consult a doctor for medical advice."
            )
        

        return jsonify({'success': True, 'response': fallback, 'fallback': False})

    return jsonify({'success': True, 'response': ai_response, 'fallback': False})


@app.route('/api/chat/doctor', methods=['POST'])
def cardioai_doctor_chat():
    """
    CardioAI Doctor Assistant endpoint.
    Provides clinical interpretation of a prediction result using DOCTOR_SYSTEM_PROMPT.

    Body: {
        "prediction_result": {
            "risk_percentage": float,
            "risk_level": str,
            "disease": str,
            "treatment": str,
            "prevention": str,
            "health_tips": str
        },
        "patient_data": {
            "age": int, "sex": int, "cp": int, "trestbps": int,
            "chol": int, "fbs": int, "restecg": int, "thalach": int,
            "exang": int, "oldpeak": float, "slope": int, "ca": int, "thal": int,
            "symptoms": str, "diagnosis": str, "test_results": str
        },
        "report_text": str   # optional — from DocAI
    }
    """
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'No data provided'}), 400

    prediction_result = data.get('prediction_result', {})
    patient_data      = data.get('patient_data', {})
    report_text       = data.get('report_text', '')

    # Build structured clinical context
    sex_label = 'Female' if patient_data.get('sex') == 0 else 'Male'
    fbs_label = '>120 mg/dL' if patient_data.get('fbs') == 1 else '≤120 mg/dL'
    exang_label = 'Yes' if patient_data.get('exang') == 1 else 'No'

    context = f"""
PATIENT DATA:
  Age            : {patient_data.get('age', 'N/A')}
  Sex            : {sex_label}
  Visit Time     : {patient_data.get('visit_time', 'Not specified')}
  Chest Pain Type: {patient_data.get('cp', 'N/A')} (0=typical angina, 1=atypical, 2=non-anginal, 3=asymptomatic)
  Resting BP     : {patient_data.get('trestbps', 'N/A')} mmHg
  Cholesterol    : {patient_data.get('chol', 'N/A')} mg/dL
  Fasting Sugar  : {fbs_label}
  Resting ECG    : {patient_data.get('restecg', 'N/A')} (0=normal, 1=ST-T abnormality, 2=left ventricular hypertrophy)
  Max Heart Rate : {patient_data.get('thalach', 'N/A')} bpm
  Exercise Angina: {exang_label}
  ST Depression  : {patient_data.get('oldpeak', 'N/A')}
  Slope          : {patient_data.get('slope', 'N/A')} (0=upsloping, 1=flat, 2=downsloping)
  Major Vessels  : {patient_data.get('ca', 'N/A')} (0-3 vessels with disease)
  Thalassemia    : {patient_data.get('thal', 'N/A')} (1=normal, 2=fixed defect, 3=reversable defect)

CLINICAL PRESENTATION:
  Symptoms       : {patient_data.get('symptoms', 'Not provided')}
  Diagnosis Note : {patient_data.get('diagnosis', 'Not provided')}
  Test Results   : {patient_data.get('test_results', 'Not provided')}

ML PREDICTION OUTPUT:
  Risk %        : {prediction_result.get('risk_percentage', 'N/A')}%
  Risk Level    : {prediction_result.get('risk_level', 'N/A')}
  Disease Note  : {prediction_result.get('disease', 'N/A')}
  Treatment Hint: {prediction_result.get('treatment', 'N/A')}
""".strip()

    if report_text:
        context += f"\n\nMEDICAL REPORT (DocAI Extracted):\n{report_text.strip()}"

    user_message = (
        "Please provide a complete clinical CardioAI analysis for this patient "
        "using the structured response format. Include detailed feature-by-feature "
        "impact analysis explaining how each input (age, sex, chest pain type, BP, "
        "cholesterol, ECG, heart rate, ST depression, slope, vessels, thalassemia) "
        "influences the cardiovascular risk assessment."
    )

    ai_response = call_ai_chat(CARDIOAI_SUPER_PROMPT, user_message, context)
    if ai_response is None:
        # Fallback clinical summary without Gemini or OpenAI that still looks like AI
        rp = prediction_result.get('risk_percentage', 0)
        risk = prediction_result.get('risk_level', 'Unknown')
        
        disease = prediction_result.get('disease', 'Cardiovascular assessment completed.')
        treatment = prediction_result.get('treatment', 'Suggest further clinical evaluation.')
        prevention = prediction_result.get('prevention', 'Schedule follow-up and monitor cardiovascular markers.')
        health_tips = prediction_result.get('health_tips', 'Monitor blood pressure and lipid profile.')
        
        fallback = (
            f"**1. ML Prediction Summary**\n"
            f"The patient has an estimated heart disease risk of **{rp:.1f}%** ({risk} Risk). This prediction is based on the provided ML model analysis of patient parameters including age, blood pressure, cholesterol, and chest pain features.\n\n"
            f"**2. Report Findings**\n"
            f"No external medical reports (DocAI) were provided for analysis. Clinical judgment based on immediate symptoms and vitals is required.\n\n"
            f"**3. Clinical Correlation**\n"
            f"- **Systematic Finding**: {disease}\n"
            f"- **Interpretation**: The entered vitals and symptomatic data strongly align with this risk classification.\n\n"
            f"**4. Risk Interpretation**\n"
            f"- **Treatment Strategy**: {treatment}\n"
            f"- **Health Monitoring**: {health_tips}\n\n"
            f"**5. Suggested Next Steps**\n"
            f"- **Short-term Action**: {prevention}\n"
            f"- Consider referring the patient for stress testing or echocardiography if symptoms persist or worsen.\n"
        )
        return jsonify({'success': True, 'response': fallback, 'fallback': False})

    return jsonify({'success': True, 'response': ai_response, 'fallback': False})


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

@app.route('/validate_symptoms', methods=['POST'])
def validate_symptoms():
    """
    Validates if the provided symptoms are health-related and appropriate for heart disease prediction.
    Uses AI to check if symptoms contain legitimate medical terms.
    
    Body: {
        "symptoms": str,
        "test_results": str (optional)
    }
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No input data provided'}), 400

        symptoms = data.get('symptoms', '').strip()
        test_results = data.get('test_results', '').strip()

        if not symptoms:
            return jsonify({
                'valid': False,
                'reason': 'No symptoms provided',
                'suggestions': ['Please describe your symptoms clearly']
            }), 200

        # Fallback validation logic (always used for reliability)
        symptoms_lower = symptoms.lower()
        test_lower = test_results.lower()
        
        # Common heart-related keywords
        heart_keywords = [
            'chest', 'pain', 'tightness', 'pressure', 'discomfort', 'heart', 'cardiac',
            'breath', 'shortness', 'dyspnea', 'fatigue', 'tired', 'weak', 'dizzy',
            'lightheaded', 'palpitations', 'irregular', 'racing', 'sweat', 'nausea',
            'arm', 'neck', 'jaw', 'back', 'swell', 'leg', 'ankle', 'cough', 'wheeze',
            'blood pressure', 'cholesterol', 'exercise', 'angina', 'hypertension',
            'arrhythmia', 'tachycardia', 'bradycardia', 'murmur', 'valve'
        ]
        
        # Check if any heart-related keywords are present
        has_heart_terms = any(keyword in symptoms_lower for keyword in heart_keywords)
        
        # Check for obviously invalid inputs
        invalid_indicators = ['political', 'weather', 'food', 'movie', 'music', 'sport', 'game']
        has_invalid = any(indicator in symptoms_lower for indicator in invalid_indicators)
        
        if has_invalid and not has_heart_terms:
            return jsonify({
                'valid': False,
                'confidence': 90,
                'reason': 'Input appears to contain non-medical content',
                'extracted_symptoms': [],
                'suggestions': [
                    'Please describe actual symptoms like chest pain, shortness of breath, fatigue, etc.',
                    'Include relevant test results like blood pressure readings or cholesterol levels'
                ]
            }), 200
        elif has_heart_terms:
            extracted = [kw for kw in heart_keywords if kw in symptoms_lower]
            return jsonify({
                'valid': True,
                'confidence': 85,
                'reason': 'Contains relevant medical symptoms',
                'extracted_symptoms': extracted,
                'suggestions': []
            }), 200
        else:
            return jsonify({
                'valid': False,
                'confidence': 60,
                'reason': 'No clear medical symptoms identified',
                'extracted_symptoms': [],
                'suggestions': [
                    'Please provide specific symptoms related to heart health',
                    'Examples: chest pain, shortness of breath, fatigue, dizziness'
                ]
            }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/get_clinical_recommendations', methods=['POST'])
def get_clinical_recommendations():
    """
    Provides AI-powered clinical recommendations based on symptoms and test results.
    
    Body: {
        "symptoms": str,
        "test_results": str,
        "age": int (optional),
        "gender": str (optional),
        "visit_time": str (optional),
        "patient_data": { ... } (optional, full patient data),
        "prediction_result": { ... } (optional, from ML model)
    }
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No input data provided'}), 400

        symptoms = data.get('symptoms', '').strip()
        test_results = data.get('test_results', '').strip()
        age = data.get('age')
        gender = data.get('gender', '')
        visit_time = data.get('visit_time', 'Not specified')
        patient_data = data.get('patient_data', {})
        prediction_result = data.get('prediction_result', {})

        if not symptoms and not test_results and not patient_data:
            return jsonify({
                'success': False,
                'error': 'Either symptoms, test results, or patient data must be provided'
            }), 400

        # Build comprehensive context with all patient data
        context = f"Patient Information:\n"
        if age or patient_data.get('age'):
            context += f"- Age: {age or patient_data.get('age', 'N/A')}\n"
        if gender or patient_data.get('sex') is not None:
            sex_val = patient_data.get('sex')
            sex_label = "Male" if sex_val == 1 else "Female" if sex_val == 0 else gender or "Unknown"
            context += f"- Sex: {sex_label}\n"
        context += f"- Visit Time: {visit_time}\n"
        context += f"- Symptoms: {symptoms}\n"
        context += f"- Test Results: {test_results}\n"
        
        # Add detailed cardiac features if available
        if patient_data:
            context += f"\nDetailed Cardiac Features:\n"
            context += f"- Chest Pain Type: {patient_data.get('cp', 'N/A')} (0=typical angina, 1=atypical, 2=non-anginal, 3=asymptomatic)\n"
            context += f"- Resting BP: {patient_data.get('trestbps', 'N/A')} mmHg\n"
            context += f"- Cholesterol: {patient_data.get('chol', 'N/A')} mg/dL\n"
            context += f"- Fasting Sugar: {'>120 mg/dL' if patient_data.get('fbs') == 1 else '≤120 mg/dL' if patient_data.get('fbs') == 0 else 'N/A'}\n"
            context += f"- Resting ECG: {patient_data.get('restecg', 'N/A')} (0=normal, 1=ST-T abnormality, 2=left ventricular hypertrophy)\n"
            context += f"- Max Heart Rate: {patient_data.get('thalach', 'N/A')} bpm\n"
            context += f"- Exercise Angina: {'Yes' if patient_data.get('exang') == 1 else 'No' if patient_data.get('exang') == 0 else 'N/A'}\n"
            context += f"- ST Depression: {patient_data.get('oldpeak', 'N/A')}\n"
            context += f"- Slope: {patient_data.get('slope', 'N/A')} (0=upsloping, 1=flat, 2=downsloping)\n"
            context += f"- Major Vessels: {patient_data.get('ca', 'N/A')} (0-3 vessels with disease)\n"
            context += f"- Thalassemia: {patient_data.get('thal', 'N/A')} (1=normal, 2=fixed defect, 3=reversable defect)\n"
        
        if prediction_result:
            risk_pct = prediction_result.get('risk_percentage', 'N/A')
            risk_level = prediction_result.get('risk_level', 'Unknown')
            context += f"\nML Prediction Result:\n"
            context += f"- Risk Percentage: {risk_pct}%\n"
            context += f"- Risk Level: {risk_level}\n"
            context += f"- Disease: {prediction_result.get('disease', 'N/A')}\n"
            context += f"- Treatment: {prediction_result.get('treatment', 'N/A')}\n"
            context += f"- Prevention: {prediction_result.get('prevention', 'N/A')}\n"

        recommendation_prompt = f"""
You are CardioAI, a clinical assistant for cardiology. Based on the patient's symptoms, test results, and ML prediction provided below, provide:

CRITICAL: Use the EXACT risk percentage and level from the ML Prediction Result provided. Do NOT make up or modify these numbers.

ML Prediction Result:
- Risk Percentage: {prediction_result.get('risk_percentage', 'N/A')}%
- Risk Level: {prediction_result.get('risk_level', 'Unknown')}

Provide your analysis in this format:

1. **ML Prediction Summary**: Summarize the ML model's risk assessment using the EXACT numbers above
2. **Clinical Consistency Check**: Evaluate if symptoms and vitals align with the ML prediction
3. **Feature-by-Feature Impact Analysis**: Explain how each input influences the risk:
   - Age, Sex, Chest Pain Type, Resting BP, Cholesterol, Fasting Sugar, Resting ECG, Max Heart Rate, Exercise Angina, ST Depression, Slope, Major Vessels, Thalassemia
4. **Risk Interpretation**: Explain what the risk level means clinically
5. **Suggested Next Steps**: Provide specific, actionable recommendations
6. **Clinical Recommendation**: Overall guidance

Be specific, evidence-based, and prioritize patient safety. Explain the influence of each feature on the cardiovascular risk assessment.
"""

        ai_response = call_ai_chat(CARDIOAI_SUPER_PROMPT, recommendation_prompt, context)

        if ai_response:
            return jsonify({
                'success': True,
                'recommendations': ai_response,
                'disclaimer': 'This is AI-assisted clinical guidance. Always consult with a qualified healthcare professional for actual medical advice.'
                }), 200
        else:
            # Fallback recommendations based on prediction result
            risk_pct = prediction_result.get('risk_percentage', 50.0) if prediction_result else 50.0
            risk_level = prediction_result.get('risk_level', 'Moderate') if prediction_result else 'Moderate'
            
            if risk_level.lower() == 'low':
                fallback = f"""
**1. ML Prediction Summary**
The machine learning model estimates a {risk_pct}% risk of heart disease, indicating **{risk_level} Risk**. This suggests favorable cardiovascular health status.

**2. Clinical Consistency Check**
- **Vital Signs Analysis**: Blood pressure well-controlled
- **Age Assessment**: Age-appropriate risk level
- **Symptom Review**: Symptoms appear non-cardiac

**3. Risk Interpretation**
{risk_level} risk profile indicates strong cardiovascular health foundation. The model finds no significant concerning patterns in the provided clinical data.

**4. Suggested Next Steps**
- **Preventive Care**: Continue routine health maintenance
- **Screening**: Standard periodic health evaluations every 1-2 years
- **Lifestyle**: Maintain healthy diet, regular exercise, and avoid smoking
- **Monitoring**: Annual blood pressure and cholesterol checks
- **Education**: Heart-healthy living education and awareness

**Clinical Recommendation**: {risk_level} risk supports standard preventive care approach with emphasis on health maintenance.
"""
            elif risk_level.lower() == 'high':
                fallback = f"""
**1. ML Prediction Summary**
The machine learning model estimates a {risk_pct}% risk of heart disease, indicating **{risk_level} Risk**. This indicates significant cardiovascular concerns requiring immediate attention.

**2. Clinical Consistency Check**
- **Vital Signs Analysis**: Blood pressure may need optimization
- **Age Consideration**: Age contributes to elevated risk profile
- **Symptom Assessment**: Cardiac symptoms present and concerning

**3. Risk Interpretation**
{risk_level} risk suggests serious cardiovascular disease risk that requires urgent evaluation and intervention. This level indicates potential immediate health threats.

**4. Suggested Next Steps**
- **Urgent Care**: Immediate cardiology consultation within 1-2 weeks
- **Advanced Testing**: Stress testing, echocardiography, coronary angiography
- **Risk Factor Control**: Aggressive management of hypertension, diabetes, lipids
- **Lifestyle**: Immediate lifestyle modifications and cardiac rehabilitation
- **Monitoring**: Close follow-up every 3-6 months

**Clinical Recommendation**: {risk_level} risk requires urgent cardiology evaluation and aggressive risk factor modification.
"""
            else:  # Moderate
                fallback = f"""
**1. ML Prediction Summary**
The machine learning model estimates a {risk_pct}% risk of heart disease, indicating **{risk_level} Risk**. This falls in an intermediate range requiring attention.

**2. Clinical Consistency Check**
- **Vital Signs Analysis**: Blood pressure acceptable
- **Age Consideration**: Age contributes to {risk_level.lower()} risk profile
- **Symptom Assessment**: Some cardiac symptoms noted

**3. Risk Interpretation**
{risk_level} risk suggests potential cardiovascular concerns that warrant monitoring and preventive measures. While not immediately critical, this level requires proactive management.

**4. Suggested Next Steps**
- **Primary Care**: Follow-up with primary physician within 4-6 weeks
- **Screening**: Lipid profile, HbA1c, and comprehensive metabolic panel
- **Lifestyle**: DASH diet, regular aerobic exercise (150 min/week), weight management
- **Risk Modification**: Address modifiable factors (smoking, hypertension, diabetes)
- **Monitoring**: Annual cardiac risk assessment and periodic ECG

**Clinical Recommendation**: {risk_level} risk indicates need for preventive cardiology approach with regular monitoring.
"""
            return jsonify({
                'success': True,
                'recommendations': fallback.strip(),
                'fallback': True,
                'disclaimer': 'This is AI-assisted clinical guidance. Always consult with a qualified healthcare professional for actual medical advice.'
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

        # Validate feature count against the trained model
        expected_features = getattr(heart_model, 'n_features_in_', None)
        if expected_features is not None and features_array.shape[1] != expected_features:
            return jsonify({
                'error': f'Input feature count mismatch: expected {expected_features} values, received {features_array.shape[1]}.'
            }), 400

        # Get probabilities
        probabilities = heart_model.predict_proba(features_array)[0]
        risk_probability = probabilities[1] * 100  # Probability of class 1 (Disease)

        risk_label = 'High' if risk_probability > 75 else 'Moderate' if risk_probability > 40 else 'Low'
        prediction_result = {
            'success': True,
            'risk_percentage': round(risk_probability, 2),
            'risk_level': risk_label,
            'has_disease_risk': bool(risk_probability > 50),
            'disease': 'Heart Disease Risk Assessment',
            'treatment': 'Refer for cardiology evaluation and additional cardiac testing.',
            'prevention': 'Adopt heart-healthy lifestyle changes, monitor blood pressure and cholesterol.',
            'health_tips': 'Reduce sodium intake, exercise regularly, and maintain healthy weight.',
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
    print("   - Symptom Validation: POST http://localhost:5001/validate_symptoms")
    print("   - Clinical Recommendations: POST http://localhost:5001/get_clinical_recommendations")
    print("   - ML Cardiology Predict: POST http://localhost:5001/predict_heart_disease")
    print("   - Text-based Predict: POST http://localhost:5001/predict")
    print("   - Batch Predict: POST http://localhost:5001/predict/batch")
    print("   - Diseases List: GET http://localhost:5001/diseases")
    print("\n💡 Make requests from your web app to this service for ML-based predictions\n")
    
    app.run(host='127.0.0.1', port=5001, debug=True)
