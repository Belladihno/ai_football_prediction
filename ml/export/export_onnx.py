"""
ONNX Export for Football Prediction Models

This script exports trained models to ONNX format for use
with ONNX Runtime in Node.js.

Supports:
- XGBoost
- Random Forest
- Logistic Regression
- Scikit-learn models
"""

import numpy as np
import json
import pandas as pd
import onnx
from onnxconverter_common import FloatTensorType
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
import xgboost as xgb
from typing import Dict, Any, Optional
import warnings


class ONNXExporter:
    """
    Export trained models to ONNX format.
    """

    def __init__(self, input_dim: int = 30):
        """
        Initialize exporter.

        Args:
            input_dim: Number of input features
        """
        self.input_dim = input_dim
        self.initial_type = [('float_input', FloatTensorType([None, input_dim]))]

    def export_xgboost(
        self,
        model: xgb.XGBClassifier,
        model_name: str,
        output_path: str
    ) -> None:
        """
        Export XGBoost model to ONNX.

        Args:
            model: Trained XGBoost_name: Name for the model
            model
            model output_path: Path to save ONNX file
        """
        # Convert to ONNX using skl2onnx
        # XGBoost requires special handling

        try:
            onnx_model = convert_sklearn(
                model,
                initial_types=self.initial_type,
                target_opset=12,
            )

            # Save model
            onnx.save(onnx_model, output_path)

            # Save metadata
            metadata = {
                'model_name': model_name,
                'model_type': 'xgboost',
                'input_dim': self.input_dim,
                'num_classes': 3,
                'n_estimators': model.n_estimators,
                'max_depth': model.max_depth,
            }

            metadata_path = output_path.replace('.onnx', '_metadata.json')
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)

            print(f"[OK] Exported XGBoost model to {output_path}")
            print(f"  Metadata saved to {metadata_path}")

        except Exception as e:
            print(f"[ERROR] Error exporting XGBoost model: {e}")
            # Fallback: save model parameters
            self._save_xgboost_params(model, model_name, output_path)

    def _save_xgboost_params(
        self,
        model: xgb.XGBClassifier,
        model_name: str,
        output_path: str
    ) -> None:
        """
        Save XGBoost model parameters as JSON (fallback).

        Args:
            model: Trained XGBoost model
            model_name: Name for the model
            output_path: Path to save JSON file
        """
        # Extract model parameters
        model_data = {
            'model_name': model_name,
            'model_type': 'xgboost_json',
            'input_dim': self.input_dim,
            'num_classes': 3,
            'n_estimators': int(model.n_estimators),
            'max_depth': int(model.max_depth),
            'learning_rate': float(model.learning_rate),
            'tree_structure': model.get_booster().dump_model() if model.get_booster() else None,
        }

        # Save as JSON
        with open(output_path, 'w') as f:
            json.dump(model_data, f, indent=2)

        print(f"[OK] Saved XGBoost parameters to {output_path}")
        print("  (Note: This is a JSON fallback. Install onnx for proper ONNX export)")

    def export_random_forest(
        self,
        model,
        model_name: str,
        output_path: str
    ) -> None:
        """
        Export Random Forest model to ONNX.

        Args:
            model: Trained Random Forest model
            model_name: Name for the model
            output_path: Path to save ONNX file
        """
        try:
            onnx_model = convert_sklearn(
                model,
                initial_types=self.initial_type,
                target_opset=12,
            )

            # Save model
            onnx.save(onnx_model, output_path)

            # Save metadata
            metadata = {
                'model_name': model_name,
                'model_type': 'random_forest',
                'input_dim': self.input_dim,
                'num_classes': 3,
                'n_estimators': model.n_estimators,
                'max_depth': model.max_depth,
            }

            metadata_path = output_path.replace('.onnx', '_metadata.json')
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)

            print(f"[OK] Exported Random Forest model to {output_path}")
            print(f"  Metadata saved to {metadata_path}")

        except Exception as e:
            print(f"[ERROR] Error exporting Random Forest model: {e}")

    def export_logistic_regression(
        self,
        model,
        model_name: str,
        output_path: str
    ) -> None:
        """
        Export Logistic Regression model to ONNX.

        Args:
            model: Trained Logistic Regression model
            model_name: Name for the model
            output_path: Path to save ONNX file
        """
        try:
            onnx_model = convert_sklearn(
                model,
                initial_types=self.initial_type,
                target_opset=12,
            )

            # Save model
            onnx.save(onnx_model, output_path)

            # Save metadata
            metadata = {
                'model_name': model_name,
                'model_type': 'logistic_regression',
                'input_dim': self.input_dim,
                'num_classes': 3,
                'coefficients': model.coef_.tolist(),
                'intercepts': model.intercept_.tolist(),
            }

            metadata_path = output_path.replace('.onnx', '_metadata.json')
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)

            print(f"[OK] Exported Logistic Regression model to {output_path}")
            print(f"  Metadata saved to {metadata_path}")

        except Exception as e:
            print(f"[ERROR] Error exporting Logistic Regression model: {e}")


def create_metadata_json(
    model_name: str,
    model_type: str,
    metrics: Dict[str, float],
    feature_names: list,
    output_path: str
) -> None:
    """
    Create model metadata JSON file.

    Args:
        model_name: Name of the model
        model_type: Type of model
        metrics: Dictionary of evaluation metrics
        feature_names: List of feature names
        output_path: Path to save metadata
    """
    metadata = {
        'model_name': model_name,
        'model_type': model_type,
        'version': '1.0.0',
        'created_at': pd.Timestamp.now().isoformat(),
        'metrics': {
            'accuracy': float(metrics.get('accuracy', 0)),
            'brier_score': float(metrics.get('brier_score', 0)),
            'log_loss': float(metrics.get('log_loss', 0)),
        },
        'features': {
            'count': len(feature_names),
            'names': feature_names,
        },
        'classes': ['HOME', 'DRAW', 'AWAY'],
    }

    with open(output_path, 'w') as f:
        json.dump(metadata, f, indent=2)

    print(f"[OK] Created metadata file: {output_path}")


# Suppress warnings for cleaner output
warnings.filterwarnings('ignore')


if __name__ == '__main__':
    print("ONNX Export Module")
    print("="*50)

    # Example: Export a model
    exporter = ONNXExporter(input_dim=30)

    # Create a sample XGBoost model
    import xgboost as xgb

    X = np.random.randn(1000, 30)
    y = np.random.choice([0, 1, 2], size=1000)

    xgb_model = xgb.XGBClassifier(
        n_estimators=100,
        max_depth=6,
        learning_rate=0.1,
        random_state=42,
    )
    xgb_model.fit(X, y)

    # Export
    exporter.export_xgboost(xgb_model, 'xgboost_v1', '../models/xgboost_v1.onnx')

    print("\n" + "="*50)
    print("To use in Node.js:")
    print("  npm install onnxruntime")
    print("\nExample usage:")
    print("  const session = await onnxruntime.InferenceSession('xgboost_v1.onnx');")
    print("  const results = await session.run(['output'], { 'float_input': inputData });")
