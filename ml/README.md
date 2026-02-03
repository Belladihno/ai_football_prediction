# Football Prediction ML Module

This module contains the machine learning pipeline for predicting football match outcomes.

## Directory Structure

```
ml/
├── requirements.txt        # Python dependencies
├── README.md              # This file
│
├── training/              # Training scripts
│   ├── train.py           # Main training pipeline
│   ├── feature_engineering.py  # Feature extraction
│   ├── baseline_models.py      # Model training
│   └── evaluate_model.py       # Model evaluation
│
├── models/                # Output models
│   ├── xgboost_v1.onnx
│   ├── random_forest_v1.onnx
│   └── poisson_v1.onnx
│
└── export/                # Export utilities
    └── export_onnx.py     # ONNX export
```

## Installation

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

## Usage

### Train Models

```bash
cd training
python train.py
```

This will:
1. Load training data from PostgreSQL
2. Extract 30 features per match
3. Train 4 models: Logistic Regression, XGBoost, Random Forest, Poisson
4. Evaluate and compare all models
5. Export the best model to ONNX format

### Use in Node.js

```javascript
const onnxruntime = require('onnxruntime');

// Load model
const session = await onnxruntime.InferenceSession('models/xgboost_v1.onnx');

// Prepare input (30 features)
const input = new Float32Array([
    0.8, 0.6, 1.8, 1.5, 2.1,  // Form features
    3, 7, 5, -2, 1.5, 1.2,    // Strength features
    0.6, 2, 2.5,              // H2H features
    1.0, 0.7, 0.7,            // Context features
    0.8, 0.9, 0.9, 0.95,      // Injury features
    2, 1, 5, 3,               // Momentum features
    0.8, 0.6,                 # Managerial features
    0.1, 0.7,                 # Environmental features
    0.45                      # Market feature
]);

// Run inference
const results = await session.run(['output'], { 'float_input': [input] });

// Get probabilities
const probs = results.output.data;
// probs = [homeProb, drawProb, awayProb]
```

## Features (30 Total)

| Category | Features | Count |
|----------|----------|-------|
| Form | Home/away form score, points per game, goals per game | 6 |
| Strength | League position, goal difference, xG | 5 |
| H2H | Form score, home wins, avg goals | 3 |
| Context | Home advantage, rest days | 3 |
| Injury | Injury count/impact (home/away) | 4 |
| Momentum | Win streak, unbeaten streak | 4 |
| Managerial | Manager tenure | 2 |
| Environmental | Weather impact, temperature | 2 |
| Market | Betting odds probability | 1 |

## Models

1. **Logistic Regression** - Fast baseline model
2. **XGBoost** - Primary model (best accuracy expected)
3. **Random Forest** - Robust backup model
4. **Poisson Regression** - Expected goals prediction

## Evaluation Metrics

- **Accuracy**: Percentage of correct predictions
- **Log Loss**: Probability calibration
- **Brier Score**: Probability accuracy
- **F1 Score**: Per-class precision/recall

## Expected Performance

- Target accuracy: >45% (excellent for football)
- Baseline (random): ~33%
- Market odds baseline: ~45-48%
