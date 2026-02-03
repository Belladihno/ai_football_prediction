"""
Baseline Models for Football Match Prediction

This script trains multiple models for predicting match outcomes:
1. Logistic Regression - Simple baseline model
2. XGBoost - Primary model for best accuracy
3. Random Forest - Robust backup model
4. Poisson Regression - For expected goals

Each model is trained on the same features and evaluated
to compare performance.
"""

import numpy as np
import pandas as pd
from typing import Dict, Tuple, Optional, List
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import accuracy_score, log_loss, classification_report
from sklearn.preprocessing import StandardScaler
import xgboost as xgb
from scipy.stats import poisson


class BaselineModels:
    """
    Train and evaluate multiple prediction models.
    """

    def __init__(self, random_state: int = 42):
        self.random_state = random_state
        self.models = {}
        self.scalers = {}
        self.feature_names = []

    def train_all(
        self,
        X: np.ndarray,
        y: np.ndarray,
        feature_names: Optional[List[str]] = None
    ) -> Dict:
        """
        Train all baseline models.

        Args:
            X: Feature matrix
            y: Labels (0=HOME, 1=DRAW, 2=AWAY)
            feature_names: List of feature names

        Returns:
            Dictionary with model results
        """
        self.feature_names = feature_names or [f'feature_{i}' for i in range(X.shape[1])]

        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=self.random_state, stratify=y
        )

        # Scale features
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled = scaler.transform(X_test)
        self.scalers['standard'] = scaler

        results = {}

        # 1. Logistic Regression Baseline
        print("Training Logistic Regression...")
        lr_model = self._train_logistic_regression(X_train_scaled, X_test_scaled, y_train, y_test)
        self.models['logistic'] = lr_model['model']
        results['logistic'] = lr_model

        # 2. XGBoost
        print("\nTraining XGBoost...")
        xgb_model = self._train_xgboost(X_train, X_test, y_train, y_test)
        self.models['xgboost'] = xgb_model['model']
        results['xgboost'] = xgb_model

        # 3. Random Forest
        print("\nTraining Random Forest...")
        rf_model = self._train_random_forest(X_train, X_test, y_train, y_test)
        self.models['random_forest'] = rf_model['model']
        results['random_forest'] = rf_model

        return results

    def _train_logistic_regression(
        self,
        X_train: np.ndarray,
        X_test: np.ndarray,
        y_train: np.ndarray,
        y_test: np.ndarray
    ) -> Dict:
        """Train and evaluate logistic regression."""
        model = LogisticRegression(
            max_iter=1000,
            solver='lbfgs',
            random_state=self.random_state,
            C=1.0,
        )

        model.fit(X_train, y_train)

        y_pred = model.predict(X_test)
        y_proba = model.predict_proba(X_test)

        return {
            'model': model,
            'y_test': y_test,
            'accuracy': accuracy_score(y_test, y_pred),
            'log_loss': log_loss(y_test, y_proba),
            'predictions': y_pred,
            'probabilities': y_proba,
        }

    def _train_xgboost(
        self,
        X_train: np.ndarray,
        X_test: np.ndarray,
        y_train: np.ndarray,
        y_test: np.ndarray
    ) -> Dict:
        """Train and evaluate XGBoost."""
        model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
            random_state=self.random_state,
            eval_metric='mlogloss',
        )

        model.fit(X_train, y_train)

        y_pred = model.predict(X_test)
        y_proba = model.predict_proba(X_test)

        return {
            'model': model,
            'y_test': y_test,
            'accuracy': accuracy_score(y_test, y_pred),
            'log_loss': log_loss(y_test, y_proba),
            'predictions': y_pred,
            'probabilities': y_proba,
        }

    def _train_random_forest(
        self,
        X_train: np.ndarray,
        X_test: np.ndarray,
        y_train: np.ndarray,
        y_test: np.ndarray
    ) -> Dict:
        """Train and evaluate random forest."""
        model = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            random_state=self.random_state,
            n_jobs=-1,
        )

        model.fit(X_train, y_train)

        y_pred = model.predict(X_test)
        y_proba = model.predict_proba(X_test)

        return {
            'model': model,
            'y_test': y_test,
            'accuracy': accuracy_score(y_test, y_pred),
            'log_loss': log_loss(y_test, y_proba),
            'predictions': y_pred,
            'probabilities': y_proba,
        }

    def get_best_model(self, results: Dict) -> str:
        """
        Get the name of the best model based on accuracy.

        Args:
            results: Dictionary with model results

        Returns:
            Name of best model
        """
        best_model = max(results.keys(), key=lambda k: results[k]['accuracy'])
        return best_model

    def print_results(self, results: Dict) -> None:
        """Print formatted results for all models."""
        print("\n" + "="*60)
        print("MODEL RESULTS COMPARISON")
        print("="*60)

        for name, result in results.items():
            print(f"\n{name.upper().replace('_', ' ')}")
            print(f"  Accuracy: {result['accuracy']:.4f} ({result['accuracy']*100:.2f}%)")
            print(f"  Log Loss: {result['log_loss']:.4f}")

        print("\n" + "="*60)
        best = self.get_best_model(results)
        print(f"BEST MODEL: {best.upper()} (Accuracy: {results[best]['accuracy']:.4f})")
        print("="*60)


class PoissonGoalsModel:
    """
    Poisson regression model for predicting expected goals.

    This is a separate model that predicts the number of goals
    each team is likely to score, rather than the match outcome.
    """

    def __init__(self, random_state: int = 42):
        self.random_state = random_state
        self.home_lambda = None
        self.away_lambda = None

    def fit(self, X: np.ndarray, home_goals: np.ndarray, away_goals: np.ndarray) -> None:
        """
        Fit Poisson models for home and away goals.

        Args:
            X: Feature matrix
            home_goals: Array of home team goals
            away_goals: Array of away team goals
        """
        # Simple approach: use team strength features
        # X should include home/away strength features

        # Estimate lambda (expected goals) using simple average
        # In practice, you'd use a more sophisticated model
        self.home_lambda = np.mean(home_goals)
        self.away_lambda = np.mean(away_goals)

    def predict(self, home_features: np.ndarray, away_features: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """
        Predict goal distributions.

        Args:
            home_features: Features for home team
            away_features: Features for away team

        Returns:
            Tuple of (home_goals_dist, away_goals_dist) - probability arrays
        """
        # Simple Poisson prediction
        # Adjust lambda based on team strength features

        home_lambda = self._adjust_lambda(
            self.home_lambda,
            home_features,
            away_features
        )
        away_lambda = self._adjust_lambda(
            self.away_lambda,
            away_features,
            home_features,
            is_away=True
        )

        # Generate probability distributions
        home_dist = self._poisson_dist(home_lambda)
        away_dist = self._poisson_dist(away_lambda)

        return home_dist, away_dist

    def _adjust_lambda(
        self,
        base_lambda: float,
        team_features: np.ndarray,
        opponent_features: np.ndarray,
        is_away: bool = False
    ) -> float:
        """
        Adjust expected goals based on team strength.

        Args:
            base_lambda: Base expected goals
            team_features: Team's feature vector
            opponent_features: Opponent's feature vector
            is_away: Whether team is playing away

        Returns:
            Adjusted lambda value
        """
        # Simple adjustment: compare league positions
        # Team features should include league position at index 0
        # Opponent features should include league position at index 1

        if len(team_features) >= 2 and len(opponent_features) >= 2:
            team_pos = team_features[0] if not is_away else team_features[1]
            opp_pos = opponent_features[0] if is_away else opponent_features[1]

            # Better position = more goals
            position_factor = (19 - team_pos) / (19 - opp_pos + 1)
            base_lambda *= position_factor

        # Away teams score less
        if is_away:
            base_lambda *= 0.9

        return max(0.1, base_lambda)  # Minimum 0.1 goals

    def _poisson_dist(self, lam: float) -> np.ndarray:
        """
        Generate Poisson probability distribution.

        Args:
            lam: Expected number of goals (lambda)

        Returns:
            Array of probabilities for 0-10 goals
        """
        probs = []
        for k in range(11):  # 0 to 10 goals
            prob = (lam ** k * np.exp(-lam)) / np.math.factorial(k)
            probs.append(prob)

        # Normalize
        probs = np.array(probs)
        return probs / probs.sum()

    def predict_outcome_probs(
        self,
        home_goals_dist: np.ndarray,
        away_goals_dist: np.ndarray
    ) -> Dict[str, float]:
        """
        Calculate match outcome probabilities from goal distributions.

        Args:
            home_goals_dist: Probability distribution for home goals
            away_goals_dist: Probability distribution for away goals

        Returns:
            Dictionary with HOME, DRAW, AWAY probabilities
        """
        home_win = 0
        draw = 0
        away_win = 0

        for h in range(len(home_goals_dist)):
            for a in range(len(away_goals_dist)):
                prob = home_goals_dist[h] * away_goals_dist[a]

                if h > a:
                    home_win += prob
                elif h == a:
                    draw += prob
                else:
                    away_win += prob

        return {
            'HOME': home_win,
            'DRAW': draw,
            'AWAY': away_win,
        }


if __name__ == '__main__':
    # Example usage
    print("Baseline Models Module")
    print("="*50)

    # Create sample data
    np.random.seed(42)
    X = np.random.randn(1000, 30)  # 1000 samples, 30 features
    y = np.random.choice([0, 1, 2], size=1000, p=[0.46, 0.28, 0.26])

    # Train models
    baseline = BaselineModels(random_state=42)
    results = baseline.train_all(X, y)
    baseline.print_results(results)

    # Test Poisson model
    print("\n" + "="*50)
    print("Poisson Goals Model")
    print("="*50)

    poisson_model = PoissonGoalsModel()
    poisson_model.fit(X, np.random.poisson(1.5, 1000), np.random.poisson(1.2, 1000))

    home_dist, away_dist = poisson_model.predict(X[0], X[1])
    outcome_probs = poisson_model.predict_outcome_probs(home_dist, away_dist)

    print(f"\nSample prediction:")
    print(f"  Home win prob: {outcome_probs['HOME']:.3f}")
    print(f"  Draw prob: {outcome_probs['DRAW']:.3f}")
    print(f"  Away win prob: {outcome_probs['AWAY']:.3f}")

