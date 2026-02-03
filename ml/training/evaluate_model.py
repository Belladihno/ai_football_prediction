"""
Model Evaluation for Football Match Prediction

This script evaluates trained models using various metrics:
- Accuracy (overall correct predictions)
- Brier Score (probability calibration)
- Confusion Matrix
- Per-class metrics (precision, recall, F1)
- Calibration curves
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional
from sklearn.metrics import (
    accuracy_score,
    log_loss,
    brier_score_loss,
    confusion_matrix,
    classification_report,
    precision_recall_fscore_support,
)
import matplotlib.pyplot as plt
import seaborn as sns


class ModelEvaluator:
    """
    Evaluate and compare prediction models.
    """

    def __init__(self):
        self.results = {}

    def evaluate(
        self,
        model_name: str,
        y_true: np.ndarray,
        y_pred: np.ndarray,
        y_proba: np.ndarray,
        feature_names: Optional[List[str]] = None
    ) -> Dict:
        """
        Evaluate a single model.

        Args:
            model_name: Name of the model
            y_true: True labels
            y_pred: Predicted labels
            y_proba: Predicted probabilities
            feature_names: List of feature names

        Returns:
            Dictionary with all metrics
        """
        metrics = {}

        # Basic metrics
        metrics['accuracy'] = accuracy_score(y_true, y_pred)
        metrics['log_loss'] = log_loss(y_true, y_proba)

        # Brier score (for binary, so compute for each class and average)
        metrics['brier_score'] = self._calc_brier_score(y_true, y_proba)

        # Confusion matrix
        metrics['confusion_matrix'] = confusion_matrix(y_true, y_pred)

        # Per-class metrics
        precision, recall, f1, support = precision_recall_fscore_support(
            y_true, y_pred, average=None
        )
        metrics['per_class'] = {
            'precision': precision.tolist(),
            'recall': recall.tolist(),
            'f1': f1.tolist(),
            'support': support.tolist(),
        }

        # Per-class metrics (weighted average)
        metrics['weighted_avg'] = {
            'precision': np.average(precision, weights=support),
            'recall': np.average(recall, weights=support),
            'f1': np.average(f1, weights=support),
        }

        # Store results
        self.results[model_name] = metrics

        return metrics

    def _calc_brier_score(self, y_true: np.ndarray, y_proba: np.ndarray) -> float:
        """
        Calculate Brier score for multi-class.

        Args:
            y_true: True labels
            y_proba: Predicted probabilities

        Returns:
            Brier score (lower is better)
        """
        n_classes = y_proba.shape[1]
        brier = 0

        for i, (true_label, proba) in enumerate(zip(y_true, y_proba)):
            # Create one-hot encoding for true label
            true_onehot = np.zeros(n_classes)
            true_onehot[true_label] = 1

            # Squared difference
            brier += np.sum((proba - true_onehot) ** 2)

        return brier / len(y_true)

    def compare_models(self) -> pd.DataFrame:
        """
        Create comparison table of all evaluated models.

        Returns:
            DataFrame with model comparison
        """
        comparison = []

        for name, metrics in self.results.items():
            comparison.append({
                'Model': name,
                'Accuracy': f"{metrics['accuracy']:.4f}",
                'Log Loss': f"{metrics['log_loss']:.4f}",
                'Brier Score': f"{metrics['brier_score']:.4f}",
                'Weighted F1': f"{metrics['weighted_avg']['f1']:.4f}",
            })

        return pd.DataFrame(comparison)

    def print_report(self, model_name: str) -> None:
        """
        Print detailed evaluation report.

        Args:
            model_name: Name of the model
        """
        if model_name not in self.results:
            print(f"No results for model: {model_name}")
            return

        metrics = self.results[model_name]

        print("\n" + "="*60)
        print(f"EVALUATION REPORT: {model_name.upper()}")
        print("="*60)

        print("\n📊 OVERALL METRICS")
        print(f"  Accuracy:   {metrics['accuracy']:.4f} ({metrics['accuracy']*100:.2f}%)")
        print(f"  Log Loss:   {metrics['log_loss']:.4f}")
        print(f"  Brier Score: {metrics['brier_score']:.4f}")

        print("\n📈 PER-CLASS METRICS")
        class_names = ['HOME', 'DRAW', 'AWAY']
        print(f"  {'Class':<10} {'Precision':<12} {'Recall':<12} {'F1':<12} {'Support':<10}")
        print("  " + "-"*56)

        for i, cls in enumerate(class_names):
            print(f"  {cls:<10} "
                  f"{metrics['per_class']['precision'][i]:.4f}      "
                  f"{metrics['per_class']['recall'][i]:.4f}      "
                  f"{metrics['per_class']['f1'][i]:.4f}      "
                  f"{metrics['per_class']['support'][i]:.0f}")

        print(f"\n  Weighted Avg: "
              f"{metrics['weighted_avg']['precision']:.4f} / "
              f"{metrics['weighted_avg']['recall']:.4f} / "
              f"{metrics['weighted_avg']['f1']:.4f}")

        print("\n📋 CONFUSION MATRIX")
        print("  Predicted:  HOME  DRAW  AWAY")
        cm = metrics['confusion_matrix']
        for i, cls in enumerate(class_names):
            print(f"  Actual {cls}:  {cm[i][0]:4d}  {cm[i][1]:4d}  {cm[i][2]:4d}")

        print("\n" + "="*60)

    def plot_confusion_matrix(
        self,
        model_name: str,
        save_path: Optional[str] = None
    ) -> None:
        """
        Plot confusion matrix heatmap.

        Args:
            model_name: Name of the model
            save_path: Optional path to save the plot
        """
        if model_name not in self.results:
            print(f"No results for model: {model_name}")
            return

        cm = self.results[model_name]['confusion_matrix']

        plt.figure(figsize=(8, 6))
        sns.heatmap(
            cm,
            annot=True,
            fmt='d',
            cmap='Blues',
            xticklabels=['HOME', 'DRAW', 'AWAY'],
            yticklabels=['HOME', 'DRAW', 'AWAY']
        )
        plt.title(f'Confusion Matrix - {model_name}')
        plt.ylabel('Actual')
        plt.xlabel('Predicted')

        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
            print(f"Saved confusion matrix to: {save_path}")

        plt.close()

    def get_feature_importance(
        self,
        model,
        feature_names: List[str],
        model_type: str = 'xgboost'
    ) -> pd.DataFrame:
        """
        Extract and return feature importance.

        Args:
            model: Trained model
            feature_names: List of feature names
            model_type: Type of model (xgboost, random_forest, logistic)

        Returns:
            DataFrame with feature importance
        """
        if model_type == 'xgboost':
            importance = model.feature_importances_
        elif model_type == 'random_forest':
            importance = model.feature_importances_
        elif model_type == 'logistic':
            # For logistic regression, use mean absolute coefficients
            importance = np.mean(np.abs(model.coef_), axis=0)
        else:
            raise ValueError(f"Unknown model type: {model_type}")

        # Create DataFrame
        importance_df = pd.DataFrame({
            'Feature': feature_names,
            'Importance': importance,
        }).sort_values('Importance', ascending=False)

        return importance_df

    def plot_feature_importance(
        self,
        importance_df: pd.DataFrame,
        model_name: str,
        save_path: Optional[str] = None
    ) -> None:
        """
        Plot feature importance bar chart.

        Args:
            importance_df: DataFrame with feature importance
            model_name: Name of the model
            save_path: Optional path to save the plot
        """
        plt.figure(figsize=(12, 8))
        plt.barh(
            range(len(importance_df)),
            importance_df['Importance'].values,
        )
        plt.yticks(
            range(len(importance_df)),
            importance_df['Feature'].values
        )
        plt.xlabel('Importance')
        plt.title(f'Feature Importance - {model_name}')
        plt.gca().invert_yaxis()

        if save_path:
            plt.savefig(save_path, dpi=150, bbox_inches='tight')
            print(f"Saved feature importance to: {save_path}")

        plt.close()


def analyze_prediction_confidence(
    y_proba: np.ndarray,
    y_true: np.ndarray
) -> Dict:
    """
    Analyze how confidence relates to accuracy.

    Args:
        y_proba: Predicted probabilities
        y_true: True labels

    Returns:
        Dictionary with confidence analysis
    """
    analysis = {}

    # Get max probability for each prediction
    max_proba = np.max(y_proba, axis=1)

    # Bin by confidence level
    bins = [(0, 0.4), (0.4, 0.5), (0.5, 0.6), (0.6, 0.7), (0.7, 1.0)]

    for low, high in bins:
        mask = (max_proba >= low) & (max_proba < high)
        if mask.sum() > 0:
            subset_proba = y_proba[mask]
            subset_true = y_true[mask]

            # Get predictions
            preds = np.argmax(subset_proba, axis=1)

            # Calculate accuracy
            acc = accuracy_score(subset_true, preds)

            analysis[f'{low:.1f}-{high:.1f}'] = {
                'count': mask.sum(),
                'accuracy': acc,
                'avg_confidence': max_proba[mask].mean(),
            }

    return analysis


if __name__ == '__main__':
    # Example usage
    print("Model Evaluation Module")
    print("="*50)

    # Simulate predictions
    np.random.seed(42)
    y_true = np.random.choice([0, 1, 2], size=100, p=[0.46, 0.28, 0.26])
    y_proba = np.random.dirichlet([1, 1, 1], size=100)
    y_pred = np.argmax(y_proba, axis=1)

    # Evaluate
    evaluator = ModelEvaluator()
    evaluator.evaluate('test_model', y_true, y_pred, y_proba)

    # Print report
    evaluator.print_report('test_model')

    # Show comparison
    print("\n📊 MODEL COMPARISON")
    print(evaluator.compare_models().to_string(index=False))

    # Confidence analysis
    print("\n🎯 CONFIDENCE ANALYSIS")
    conf_analysis = analyze_prediction_confidence(y_proba, y_true)
    for conf_range, stats in conf_analysis.items():
        print(f"  {conf_range}: {stats['count']:3d} predictions, "
              f"acc={stats['accuracy']:.2f}, avg_conf={stats['avg_confidence']:.3f}")
