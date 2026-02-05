"""
Hyperparameter Tuning for Football Prediction Models

This script performs hyperparameter optimization for:
- XGBoost
- Random Forest
- Logistic Regression

Uses GridSearchCV and RandomizedSearchCV for efficient tuning.
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import json
import numpy as np
import pandas as pd
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

from sklearn.model_selection import (
    GridSearchCV, 
    RandomizedSearchCV, 
    cross_val_score,
    StratifiedKFold
)
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, log_loss, make_scorer
import xgboost as xgb

from training.database_loader import DatabaseLoader as DataLoader

OUTPUT_DIR = Path(__file__).parent.parent / 'models'


class HyperparameterTuner:
    """
    Hyperparameter tuning for football prediction models.
    """

    def __init__(self, cv_folds: int = 5, scoring: str = 'accuracy'):
        """
        Initialize tuner.

        Args:
            cv_folds: Number of cross-validation folds
            scoring: Scoring metric for optimization
        """
        self.cv_folds = cv_folds
        self.scoring = scoring
        self.cv = StratifiedKFold(n_splits=cv_folds, shuffle=True, random_state=42)
        self.results = {}

    def tune_xgboost(
        self,
        X: np.ndarray,
        y: np.ndarray,
        n_iter: int = 20
    ) -> dict:
        """
        Tune XGBoost hyperparameters using RandomizedSearchCV.

        Args:
            X: Feature matrix
            y: Target labels
            n_iter: Number of parameter settings to try

        Returns:
            Best parameters and results
        """
        print("\n" + "="*60)
        print("TUNING XGBOOST")
        print("="*60)

        param_distributions = {
            'n_estimators': [50, 100, 200, 300],
            'max_depth': [3, 4, 5, 6, 7, 8],
            'learning_rate': [0.01, 0.05, 0.1, 0.15, 0.2],
            'min_child_weight': [1, 3, 5, 7],
            'subsample': [0.6, 0.7, 0.8, 0.9, 1.0],
            'colsample_bytree': [0.6, 0.7, 0.8, 0.9, 1.0],
            'gamma': [0, 0.1, 0.2, 0.3],
            'reg_alpha': [0, 0.01, 0.1, 1],
            'reg_lambda': [0.1, 1, 5, 10],
        }

        model = xgb.XGBClassifier(
            objective='multi:softprob',
            num_class=3,
            random_state=42,
            n_jobs=-1,
            use_label_encoder=False,
            eval_metric='mlogloss'
        )

        search = RandomizedSearchCV(
            model,
            param_distributions,
            n_iter=n_iter,
            cv=self.cv,
            scoring=self.scoring,
            n_jobs=-1,
            random_state=42,
            verbose=1
        )

        search.fit(X, y)

        self.results['xgboost'] = {
            'best_params': search.best_params_,
            'best_cv_score': search.best_score_,
            'best_model': search.best_estimator_,
            'all_results': pd.DataFrame(search.cv_results_).to_dict()
        }

        print(f"\nBest CV Score: {search.best_score_:.4f}")
        print(f"Best Parameters:")
        for k, v in search.best_params_.items():
            print(f"  {k}: {v}")

        return self.results['xgboost']

    def tune_random_forest(
        self,
        X: np.ndarray,
        y: np.ndarray,
        n_iter: int = 30
    ) -> dict:
        """
        Tune Random Forest hyperparameters using RandomizedSearchCV.

        Args:
            X: Feature matrix
            y: Target labels
            n_iter: Number of parameter settings to try

        Returns:
            Best parameters and results
        """
        print("\n" + "="*60)
        print("TUNING RANDOM FOREST")
        print("="*60)

        param_distributions = {
            'n_estimators': [100, 200, 300, 500],
            'max_depth': [5, 10, 15, 20, 30, None],
            'min_samples_split': [2, 5, 10, 20],
            'min_samples_leaf': [1, 2, 4, 8],
            'max_features': ['sqrt', 'log2', None],
            'bootstrap': [True, False],
            'criterion': ['gini', 'entropy'],
        }

        model = RandomForestClassifier(
            random_state=42,
            n_jobs=-1,
            class_weight='balanced'
        )

        search = RandomizedSearchCV(
            model,
            param_distributions,
            n_iter=n_iter,
            cv=self.cv,
            scoring=self.scoring,
            n_jobs=-1,
            random_state=42,
            verbose=1
        )

        search.fit(X, y)

        self.results['random_forest'] = {
            'best_params': search.best_params_,
            'best_cv_score': search.best_score_,
            'best_model': search.best_estimator_,
            'all_results': pd.DataFrame(search.cv_results_).to_dict()
        }

        print(f"\nBest CV Score: {search.best_score_:.4f}")
        print(f"Best Parameters:")
        for k, v in search.best_params_.items():
            print(f"  {k}: {v}")

        return self.results['random_forest']

    def tune_logistic_regression(
        self,
        X: np.ndarray,
        y: np.ndarray
    ) -> dict:
        """
        Tune Logistic Regression hyperparameters using GridSearchCV.

        Args:
            X: Feature matrix
            y: Target labels

        Returns:
            Best parameters and results
        """
        print("\n" + "="*60)
        print("TUNING LOGISTIC REGRESSION")
        print("="*60)

        param_grid = {
            'C': [0.001, 0.01, 0.1, 1, 10, 100],
            'penalty': ['l1', 'l2'],
            'solver': ['liblinear', 'saga'],
            'max_iter': [100, 200, 500],
            'class_weight': [None, 'balanced'],
        }

        model = LogisticRegression(
            random_state=42,
            solver='lbfgs',
            max_iter=1000
        )

        search = GridSearchCV(
            model,
            param_grid,
            cv=self.cv,
            scoring=self.scoring,
            n_jobs=-1,
            verbose=1
        )

        search.fit(X, y)

        self.results['logistic_regression'] = {
            'best_params': search.best_params_,
            'best_cv_score': search.best_score_,
            'best_model': search.best_estimator_,
            'all_results': pd.DataFrame(search.cv_results_).to_dict()
        }

        print(f"\nBest CV Score: {search.best_score_:.4f}")
        print(f"Best Parameters:")
        for k, v in search.best_params_.items():
            print(f"  {k}: {v}")

        return self.results['logistic_regression']

    def save_results(self, output_path: str = None) -> None:
        """
        Save tuning results to JSON.

        Args:
            output_path: Path to save results
        """
        if output_path is None:
            output_path = OUTPUT_DIR / 'hyperparameter_tuning_results.json'

        # Convert numpy types to native Python types
        results_to_save = {}

        for model_name, model_results in self.results.items():
            results_to_save[model_name] = {
                'best_params': {},
                'best_cv_score': float(model_results['best_cv_score'])
            }

            for k, v in model_results['best_params'].items():
                if isinstance(v, (np.integer,)):
                    results_to_save[model_name]['best_params'][k] = int(v)
                elif isinstance(v, (np.floating,)):
                    results_to_save[model_name]['best_params'][k] = float(v)
                elif isinstance(v, np.ndarray):
                    results_to_save[model_name]['best_params'][k] = v.tolist()
                else:
                    results_to_save[model_name]['best_params'][k] = v

        with open(output_path, 'w') as f:
            json.dump(results_to_save, f, indent=2)

        print(f"\n[OK] Results saved to {output_path}")

    def get_summary(self) -> dict:
        """
        Get summary of all tuning results.

        Returns:
            Summary dictionary
        """
        summary = {
            'tuning_date': datetime.now().isoformat(),
            'cv_folds': self.cv_folds,
            'models': {}
        }

        for model_name, results in self.results.items():
            summary['models'][model_name] = {
                'best_cv_score': float(results['best_cv_score']),
                'best_params': results['best_params']
            }

        # Find best model
        best_model = max(
            self.results.items(),
            key=lambda x: x[1]['best_cv_score']
        )

        summary['best_overall'] = {
            'model': best_model[0],
            'cv_score': float(best_model[1]['best_cv_score'])
        }

        return summary


def main():
    """Main execution function."""
    print("="*60)
    print("HYPERPARAMETER TUNING")
    print("="*60)
    print(f"Started at: {datetime.now()}")

    # Load data
    print("\n[INFO] Loading training data...")
    loader = DataLoader()
    features, labels = loader.prepare_training_data()
    feature_names = None

    print(f"[OK] Loaded {len(labels)} samples with {features.shape[1]} features")

    # Initialize tuner
    tuner = HyperparameterTuner(cv_folds=5, scoring='accuracy')

    # Tune all models
    print("\n[INFO] Starting hyperparameter tuning...")

    # Tune Logistic Regression first (fastest)
    tuner.tune_logistic_regression(features, labels)

    # Tune Random Forest
    tuner.tune_random_forest(features, labels, n_iter=30)

    # Tune XGBoost
    tuner.tune_xgboost(features, labels, n_iter=30)

    # Save results
    tuner.save_results()

    # Print summary
    summary = tuner.get_summary()

    print("\n" + "="*60)
    print("TUNING SUMMARY")
    print("="*60)

    for model_name, model_summary in summary['models'].items():
        print(f"\n{model_name.upper()}:")
        print(f"  Best CV Score: {model_summary['best_cv_score']:.4f}")

    print(f"\n{'='*60}")
    print(f"BEST OVERALL: {summary['best_overall']['model'].upper()}")
    print(f"CV Score: {summary['best_overall']['cv_score']:.4f}")
    print(f"{'='*60}")

    print(f"\n[INFO] Tuning complete at: {datetime.now()}")

    return summary


if __name__ == '__main__':
    main()
