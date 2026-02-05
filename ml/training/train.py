"""
Football Match Prediction - Main Training Script

This script trains all models for football match prediction.
It combines feature engineering, model training, evaluation,
and ONNX export in a single pipeline.

Usage:
    python train.py

The script will:
1. Load training data from PostgreSQL
2. Extract features
3. Train multiple models
4. Evaluate and compare
5. Export best model to ONNX
"""

import numpy as np
import pandas as pd
import json
import os
import sys
from datetime import datetime
from typing import Dict, Tuple, Optional

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# Set UTF-8 encoding for Windows
os.environ['PYTHONIOENCODING'] = 'utf-8'

# Import our modules
from training.feature_engineering import FeatureEngineer
from training.baseline_models import BaselineModels, PoissonGoalsModel
from training.evaluate_model import ModelEvaluator
from export.export_onnx import ONNXExporter, create_metadata_json


class FootballPredictionTrainer:
    """
    Main training pipeline for football prediction models.
    """

    def __init__(self, config: Optional[Dict] = None):
        """
        Initialize trainer.

        Args:
            config: Optional configuration dictionary
        """
        self.config = config or self._default_config()

        # Initialize components
        self.feature_engineer = FeatureEngineer()
        self.model_trainer = BaselineModels(
            random_state=self.config['random_state']
        )
        self.evaluator = ModelEvaluator()
        self.exporter = ONNXExporter(input_dim=31)

        # Results storage
        self.results = {}
        self.best_model = None
        self.best_accuracy = 0

    def _default_config(self) -> Dict:
        """Default configuration."""
        current_year = datetime.now().year
        return {
            'random_state': 42,
            'test_size': 0.2,
            'model_dir': '../models',
            'metadata_dir': '../models',
            'min_accuracy_threshold': 0.40,
            # Database loading options
            'use_database': True,  # Try database first
            'leagues': ['PL', 'PD', 'BL1', 'SA', 'FL1'],  # Top 5 leagues
            'max_samples': 10000,  # Max matches to load
            'min_samples': 500,  # Minimum needed before fallback
            'synthetic_samples': 5000,  # Fallback sample count
            'fetch_historical_data': True,  # Pull season=YYYY from football-data.org if DB is sparse
            'historical_seasons': [current_year - 1, current_year - 2],
        }

    def _get_historical_seasons(self) -> Optional[list]:
        env_seasons = os.environ.get('HISTORICAL_SEASONS')
        if env_seasons:
            try:
                return [int(s.strip()) for s in env_seasons.split(',') if s.strip()]
            except ValueError:
                print(f"[WARNING] Invalid HISTORICAL_SEASONS value: {env_seasons}")
        return self.config.get('historical_seasons')

    def load_data(self) -> Tuple[np.ndarray, np.ndarray]:
        """
        Load and prepare training data.
        
        Attempts to load from PostgreSQL database first.
        Falls back to synthetic data if database is unavailable.

        Returns:
            X: Feature matrix
            y: Labels (0=HOME, 1=DRAW, 2=AWAY)
        """
        print("\n[INFO] Loading training data...")
        
        # Try to load from database first
        if self.config.get('use_database', True):
            try:
                from training.database_loader import DatabaseLoader
                from datetime import datetime, timedelta

                loader = DatabaseLoader()

                if loader.connect():
                    # Get matches from the last 2 seasons (approx 2 years)
                    min_date = datetime.now() - timedelta(days=730)

                    X, y = loader.prepare_training_data(
                        min_date=min_date,
                        leagues=self.config.get('leagues', ['PL', 'PD', 'BL1', 'SA', 'FL1']),
                        limit=self.config.get('max_samples', 10000)
                    )

                    loader.disconnect()

                    if len(X) >= self.config.get('min_samples', 500):
                        print(f"[OK] Loaded {len(X)} samples from database")
                        print(f"  Features shape: {X.shape}")
                        print(f"  Class distribution: HOME={sum(y==0)}, DRAW={sum(y==1)}, AWAY={sum(y==2)}")
                        return X, y
                    else:
                        print(f"[WARNING] Only {len(X)} samples found, need at least {self.config.get('min_samples', 500)}")
                        print("  Attempting historical data fetch...")

            except Exception as e:
                print(f"[WARNING] Database loading failed: {e}")
                print("  Attempting historical data fetch...")

        # Try fetching historical data from football-data.org if enabled
        if self.config.get('fetch_historical_data', True):
            try:
                from training.football_data_org_fetcher import FootballDataOrgFetcher
                from training.database_loader import DatabaseLoader
                from datetime import datetime, timedelta

                seasons = self._get_historical_seasons() or []
                leagues = self.config.get('leagues', ['PL', 'PD', 'BL1', 'SA', 'FL1'])

                fetcher = FootballDataOrgFetcher()
                if seasons and fetcher.can_fetch():
                    print(f"[INFO] Fetching historical seasons: {seasons}")
                    fetcher.seed_historical_matches(leagues, seasons)

                    loader = DatabaseLoader()
                    if loader.connect():
                        min_season = min(seasons)
                        min_date = datetime(min_season, 1, 1)
                        X, y = loader.prepare_training_data(
                            min_date=min_date,
                            leagues=leagues,
                            limit=self.config.get('max_samples', 10000)
                        )
                        loader.disconnect()

                        if len(X) >= self.config.get('min_samples', 500):
                            print(f"[OK] Loaded {len(X)} samples from database after historical sync")
                            return X, y
                else:
                    print("[WARNING] Historical fetch skipped (no seasons or API key missing)")

            except Exception as e:
                print(f"[WARNING] Historical fetch failed: {e}")
                print("  Falling back to synthetic data...")

        # Fallback: Generate synthetic data
        from training.database_loader import generate_synthetic_data
        
        X, y = generate_synthetic_data(
            n_samples=self.config.get('synthetic_samples', 5000),
            random_state=self.config['random_state']
        )

        return X, y

    def train(self) -> Dict:
        """
        Run the complete training pipeline.

        Returns:
            Dictionary with all results
        """
        print("\n" + "="*60)
        print("[INFO] FOOTBALL PREDICTION MODEL TRAINING")
        print("="*60)
        print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

        # Load data
        X, y = self.load_data()

        # Get feature names
        feature_names = self.feature_engineer.get_feature_names()

        # Train all models
        print("\n[INFO] Training models...")
        self.results = self.model_trainer.train_all(X, y, feature_names)

        # Print results
        self.model_trainer.print_results(self.results)

        # Evaluate all models
        print("\n[INFO] Evaluating models...")
        for name, result in self.results.items():
            self.evaluator.evaluate(
                model_name=name,
                y_true=result['y_test'],  # Use the stored y_test from model training
                y_pred=result['predictions'],
                y_proba=result['probabilities'],
                feature_names=feature_names,
            )

        # Find best model
        self.best_model = self.model_trainer.get_best_model(self.results)
        self.best_accuracy = self.results[self.best_model]['accuracy']

        # Save results
        self._save_results()

        # Export ALL models to ONNX (for ensemble and comparison)
        print(f"\n[INFO] Exporting all models to ONNX...")
        self._export_all_models(X.shape[1])

        # Generate model comparison report
        self._generate_comparison_report()

        print(f"\n[INFO] Training complete at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"   Best model: {self.best_model} (Accuracy: {self.best_accuracy:.4f})")

        return self.results

    def _export_all_models(self, input_dim: int) -> None:
        """
        Export all trained models to ONNX format.

        Args:
            input_dim: Number of input features
        """
        os.makedirs(self.config['model_dir'], exist_ok=True)

        for name, result in self.results.items():
            model = result['model']
            model_path = os.path.join(
                self.config['model_dir'],
                f'{name}_v1.onnx'
            )

            try:
                if name == 'xgboost':
                    self.exporter.export_xgboost(model, f'{name}_v1', model_path)
                elif name == 'random_forest':
                    self.exporter.export_random_forest(model, f'{name}_v1', model_path)
                elif name == 'logistic':
                    self.exporter.export_logistic_regression(model, f'{name}_v1', model_path)
                else:
                    print(f"[WARNING] No export method for model: {name}")
                    continue

                print(f"[OK] Exported {name} to {model_path}")

            except Exception as e:
                print(f"[ERROR] Failed to export {name}: {e}")

    def _generate_comparison_report(self) -> None:
        """
        Generate a comprehensive model comparison report.
        """
        report_path = os.path.join(self.config['metadata_dir'], 'model_comparison_report.md')

        with open(report_path, 'w') as f:
            f.write("# Football Prediction Model Comparison Report\n")
            f.write(f"Generated at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")

            f.write("## Model Performance Summary\n\n")
            f.write("| Model | Accuracy | Log Loss | Brier Score |\n")
            f.write("|-------|-----------|----------|--------------|\n")

            for name, result in self.results.items():
                metrics = self.evaluator.results.get(name, {})
                accuracy = result.get('accuracy', 0)
                log_loss = result.get('log_loss', 0)
                brier = metrics.get('brier_score', 0)
                f.write(f"| {name.title()} | {accuracy:.4f} | {log_loss:.4f} | {brier:.4f} |\n")

            f.write("\n## Best Model\n\n")
            f.write(f"**{self.best_model.title()}** with accuracy **{self.best_accuracy:.4f}**\n\n")

            f.write("## Recommendations\n\n")
            f.write("- Use XGBoost for best accuracy\n")
            f.write("- Use Logistic Regression for fast inference\n")
            f.write("- Random Forest provides robust backup\n")

        print(f"[OK] Generated model comparison report: {report_path}")

    def _export_best_model(self, input_dim: int) -> None:
        """
        Export the best model to ONNX format.

        Args:
            input_dim: Number of input features
        """
        os.makedirs(self.config['model_dir'], exist_ok=True)

        model_path = os.path.join(
            self.config['model_dir'],
            f'{self.best_model}_v1.onnx'
        )

        model = self.results[self.best_model]['model']

        if self.best_model == 'xgboost':
            self.exporter.export_xgboost(
                model, f'{self.best_model}_v1', model_path
            )
        elif self.best_model == 'random_forest':
            self.exporter.export_random_forest(
                model, f'{self.best_model}_v1', model_path
            )
        elif self.best_model == 'logistic':
            self.exporter.export_logistic_regression(
                model, f'{self.best_model}_v1', model_path
            )

        # Create metadata
        metadata_path = os.path.join(
            self.config['metadata_dir'],
            'metadata.json'
        )

        create_metadata_json(
            model_name=f'{self.best_model}_v1',
            model_type=self.best_model,
            metrics={
                'accuracy': self.best_accuracy,
                'brier_score': self.evaluator.results[self.best_model]['brier_score'],
                'log_loss': self.evaluator.results[self.best_model]['log_loss'],
            },
            feature_names=self.feature_engineer.get_feature_names(),
            output_path=metadata_path,
        )

    def _save_results(self) -> None:
        """Save training results to JSON."""
        results_summary = {}

        for name, result in self.results.items():
            results_summary[name] = {
                'accuracy': float(result['accuracy']),
                'log_loss': float(result['log_loss']),
            }

        results_path = '../training_results.json'
        with open(results_path, 'w') as f:
            json.dump(results_summary, f, indent=2)

        print(f"\n[INFO] Results saved to {results_path}")


def main():
    """Run the training pipeline."""
    # Create trainer with default config
    trainer = FootballPredictionTrainer()

    # Run training
    results = trainer.train()

    return results


if __name__ == '__main__':
    main()

