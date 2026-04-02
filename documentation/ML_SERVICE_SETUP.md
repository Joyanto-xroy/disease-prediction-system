# 🏥 Disease Prediction Service - Setup Guide

## Requirements

- Python 3.7+
- pip (Python package manager)

## Installation

### Step 1: Install Required Python Packages

```bash
pip install flask flask-cors scikit-learn joblib numpy
```

### Step 2: Start the Disease Prediction Service

```bash
python disease_prediction_service.py
```

You should see output like:
```
🏥 Disease Prediction Service Starting...
📍 API available at http://localhost:5001
🔗 Endpoints:
   - Health Check: GET http://localhost:5001/health
   - Predict: POST http://localhost:5001/predict
   - Batch Predict: POST http://localhost:5001/predict/batch
   - Diseases List: GET http://localhost:5001/diseases
```

## How It Works

### Machine Learning Model

The service uses **Natural Language Processing (NLP)** and **Knowledge-Based Decision Trees** to predict diseases:

1. **Symptom Matching**: Analyzes symptoms text for medical keywords
2. **Test Result Analysis**: Interprets lab results and vitals
3. **Disease Scoring**: Calculates confidence scores for each possible disease
4. **Ranking**: Returns top 5 most likely diseases with confidence percentages

### Supported Diseases

The ML model can predict over 30 diseases including:

**Respiratory:**
- Influenza, COVID-19, Pneumonia, Bronchitis, Asthma, Common Cold

**Cardiovascular:**
- Hypertension, Heart Disease, Myocardial Infarction

**Endocrine:**
- Diabetes, Hyperthyroidism, Hypothyroidism

**Gastrointestinal:**
- Gastroenteritis, Peptic Ulcer, Appendicitis

**Urinary:**
- UTI, Kidney Disease

**Dermatologic:**
- Skin Infections, Eczema

**Hematologic:**
- Anemia, Thrombocytopenia

**Infectious:**
- Malaria, Tuberculosis, Hepatitis

**Neurological:**
- Migraine, Stroke, Seizure

**Musculoskeletal:**
- Arthritis, Back Pain

## Usage in Web App

### For Doctors

1. Go to Doctor Dashboard
2. Click "Add Visit" for a patient
3. Enter patient symptoms and test results
4. Click **🔮 Predict Disease Based on Symptoms**
5. AI model will analyze and show top disease predictions with confidence scores
6. Use predictions as reference while finalizing diagnosis
7. Click "Save Visit Record" to complete

### Example Input

**Symptoms:**
```
Fever 39°C, persistent cough for 3 days, body aches, sore throat, headache
```

**Test Results:**
```
CBC: WBC 12000 (elevated), CRP 8.5, Throat culture pending
```

**Predicted Output:**
```
1. Influenza - Confidence: 85%
2. COVID-19 - Confidence: 72%
3. Common Cold - Confidence: 45%
```

## API Endpoints

### Health Check
```bash
curl http://localhost:5001/health
```

### Single Prediction
```bash
curl -X POST http://localhost:5001/predict \
  -H "Content-Type: application/json" \
  -d '{
    "symptoms": "fever, cough, body ache",
    "test_results": "elevated WBC",
    "diagnosis": ""
  }'
```

### Batch Prediction (Multiple Patients)
```bash
curl -X POST http://localhost:5001/predict/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "patient_id": "patient-1",
      "symptoms": "fever, cough",
      "test_results": "elevated WBC"
    },
    {
      "patient_id": "patient-2",
      "symptoms": "chest pain",
      "test_results": "abnormal ECG"
    }
  ]'
```

### Get Diseases List
```bash
curl http://localhost:5001/diseases
```

## Troubleshooting

### Service won't start
- Check Python version: `python --version` (should be 3.7+)
- Install dependencies: `pip install -r requirements.txt`
- Check if port 5001 is available: `netstat -an | grep 5001`

### Predictions not working in web app
- Make sure disease_prediction_service.py is running
- Check browser console for errors (F12 → Console)
- Verify the service is accessible: visit `http://localhost:5001/health` in browser
- Ensure Flask is installed: `pip install flask flask-cors`

### Windows Users
If you prefer a more straightforward installation:
```bash
# Install Python from: https://www.python.org/downloads/
# Then in Command Prompt:
pip install --upgrade pip
pip install flask flask-cors scikit-learn joblib numpy
python disease_prediction_service.py
```

### Mac/Linux Users
```bash
# Install Python (if not already installed)
brew install python3  # macOS
sudo apt-get install python3  # Linux

# Install dependencies
pip3 install flask flask-cors scikit-learn joblib numpy

# Run service
python3 disease_prediction_service.py
```

## Important Notes

⚠️ **MEDICAL DISCLAIMER:**
- This AI prediction system is for **reference and educational purposes only**
- Always rely on clinical judgment and proper medical investigations
- This system does NOT replace professional medical diagnosis
- Use the predictions as a supportive tool, not as standalone diagnosis
- Verify with lab tests, imaging, and clinical examination
- Never make treatment decisions based solely on AI predictions

## Features

✅ 30+ diseases supported  
✅ Multi-keyword symptom matching  
✅ Test result analysis  
✅ Confidence scoring  
✅ REST API interface  
✅ CORS enabled for web app access  
✅ Easy integration with doctors' dashboard  
✅ Real-time predictions  

## Future Enhancements

- [ ] Deep learning model (Neural Networks)
- [ ] Training data from real patient records
- [ ] Severity assessment
- [ ] Drug interaction checker
- [ ] Vaccination history integration
- [ ] Gender/age-specific predictions
- [ ] Persistent model training

---

**Questions or Issues?**  
Check the service logs in the terminal for detailed error messages.
