"""
Feature Engineering for Football Match Prediction

This script extracts and transforms features from raw match data
to create ML-ready training datasets.

Features extracted (30 total):
- Form features (6): Last 5 results, goals, points per game
- Strength features (5): League position, goal difference, xG
- H2H features (3): Head-to-head history
- Context features (3): Home advantage, rest days
- Injury features (4): Missing players, impact scores
- Momentum features (4): Win streaks, unbeaten streaks
- Managerial features (2): Manager tenure
- Environmental features (2): Weather, temperature
- Market feature (1): Betting odds baseline
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional


class FeatureEngineer:
    """
    Extract and transform features for football prediction models.
    """

    def __init__(self):
        # Feature names for later reference
        self.feature_names = [
            # Form features (6)
            'home_form_score',
            'away_form_score',
            'home_points_per_game',
            'away_points_per_game',
            'home_goals_per_game',
            'away_goals_per_game',
            # Strength features (5)
            'home_league_position',
            'away_league_position',
            'home_goal_difference',
            'away_goal_difference',
            'home_xg',
            'away_xg',
            # H2H features (3)
            'h2h_form_score',
            'home_h2h_wins',
            'h2h_avg_goals',
            # Context features (3)
            'home_advantage',
            'home_rest_days',
            'away_rest_days',
            # Injury features (4)
            'home_injury_count',
            'away_injury_count',
            'home_injury_impact',
            'away_injury_impact',
            # Momentum features (4)
            'home_win_streak',
            'away_win_streak',
            'home_unbeaten_streak',
            'away_unbeaten_streak',
            # Managerial features (2)
            'home_manager_tenure',
            'away_manager_tenure',
            # Environmental features (2)
            'weather_impact',
            'temperature',
            # Market feature (1)
            'market_home_prob',
        ]

    def extract_features(
        self,
        home_team_data: Dict,
        away_team_data: Dict,
        h2h_data: List[Dict],
        injury_data: Dict,
        weather_data: Dict,
        odds_data: Dict,
    ) -> np.ndarray:
        """
        Extract all features for a single match.

        Args:
            home_team_data: Home team statistics
            away_team_data: Away team statistics
            h2h_data: Head-to-head match history
            injury_data: Injury information for both teams
            weather_data: Weather conditions
            odds_data: Betting odds

        Returns:
            Numpy array of 30 features
        """
        features = []

        # ===== FORM FEATURES (6) =====
        features.append(self._calc_form_score(home_team_data.get('last_results', '')))
        features.append(self._calc_form_score(away_team_data.get('last_results', '')))
        features.append(home_team_data.get('points_per_game', 0))
        features.append(away_team_data.get('points_per_game', 0))
        features.append(home_team_data.get('goals_scored_per_game', 0))
        features.append(away_team_data.get('goals_scored_per_game', 0))

        # ===== STRENGTH FEATURES (5) =====
        features.append(home_team_data.get('league_position', 10))
        features.append(away_team_data.get('league_position', 10))
        features.append(home_team_data.get('goal_difference', 0) / 50)  # Normalize
        features.append(away_team_data.get('goal_difference', 0) / 50)
        features.append(home_team_data.get('xg', 1.5))
        features.append(away_team_data.get('xg', 1.2))

        # ===== H2H FEATURES (3) =====
        features.append(self._calc_h2h_form_score(h2h_data, home_team_data.get('id')))
        features.append(self._count_h2h_wins(h2h_data, home_team_data.get('id')))
        features.append(self._calc_h2h_avg_goals(h2h_data))

        # ===== CONTEXT FEATURES (3) =====
        features.append(1.0)  # Home advantage factor
        features.append(min(home_team_data.get('days_since_last_match', 7) / 14, 1))
        features.append(min(away_team_data.get('days_since_last_match', 7) / 14, 1))

        # ===== INJURY FEATURES (4) =====
        features.append(min(injury_data.get('home_count', 0) / 5, 1))
        features.append(min(injury_data.get('away_count', 0) / 5, 1))
        features.append(1 - injury_data.get('home_impact', 0))
        features.append(1 - injury_data.get('away_impact', 0))

        # ===== MOMENTUM FEATURES (4) =====
        features.append(min(home_team_data.get('win_streak', 0) / 5, 1))
        features.append(min(away_team_data.get('win_streak', 0) / 5, 1))
        features.append(min(home_team_data.get('unbeaten_streak', 0) / 10, 1))
        features.append(min(away_team_data.get('unbeaten_streak', 0) / 10, 1))

        # ===== MANAGERIAL FEATURES (2) =====
        features.append(min(home_team_data.get('manager_tenure_days', 365) / 1000, 1))
        features.append(min(away_team_data.get('manager_tenure_days', 365) / 1000, 1))

        # ===== ENVIRONMENTAL FEATURES (2) =====
        features.append(weather_data.get('impact', 0))
        features.append((weather_data.get('temperature', 15) + 30) / 60)  # Normalize -30 to 30

        # ===== MARKET FEATURE (1) =====
        features.append(odds_data.get('home_prob', 0.45))

        return np.array(features)

    def _calc_form_score(self, form_string: str) -> float:
        """
        Convert W/D/L form string to numeric score.

        Args:
            form_string: String like 'WDLWW'

        Returns:
            Score from 0 to 1
        """
        if not form_string:
            return 0.5

        score = 0
        for char in form_string:
            if char == 'W':
                score += 1
            elif char == 'D':
                score += 0.5

        return score / len(form_string)

    def _calc_h2h_form_score(
        self,
        h2h_matches: List[Dict],
        home_team_id: str
    ) -> float:
        """
        Calculate form score for home team in H2H matches.

        Args:
            h2h_matches: List of historical matches
            home_team_id: ID of home team

        Returns:
            Form score from 0 to 1
        """
        if not h2h_matches:
            return 0.5

        score = 0
        count = 0

        for match in h2h_matches[-5:]:  # Last 5 meetings
            is_home = match.get('home_team_id') == home_team_id
            result = match.get('result')

            if result == 'HOME_WIN':
                score += 1 if is_home else 0
            elif result == 'DRAW':
                score += 0.5
            count += 1

        return score / count if count > 0 else 0.5

    def _count_h2h_wins(
        self,
        h2h_matches: List[Dict],
        home_team_id: str
    ) -> float:
        """
        Count wins for home team in H2H matches.

        Args:
            h2h_matches: List of historical matches
            home_team_id: ID of home team

        Returns:
            Win count (normalized to 0-1)
        """
        if not h2h_matches:
            return 0.5

        wins = 0
        for match in h2h_matches[-5:]:
            is_home = match.get('home_team_id') == home_team_id
            result = match.get('result')

            if result == 'HOME_WIN' and is_home:
                wins += 1

        return wins / 5

    def _calc_h2h_avg_goals(self, h2h_matches: List[Dict]) -> float:
        """
        Calculate average goals in H2H matches.

        Args:
            h2h_matches: List of historical matches

        Returns:
            Average goals per match (normalized to 0-1)
        """
        if not h2h_matches:
            return 0.5

        total_goals = 0
        for match in h2h_matches[-5:]:
            total_goals += match.get('home_goals', 0) + match.get('away_goals', 0)

        return (total_goals / len(h2h_matches)) / 5  # Normalize to ~3 goals max

    def prepare_training_data(
        self,
        matches: pd.DataFrame,
        labels: pd.Series
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Prepare feature matrix and labels for training.

        Args:
            matches: DataFrame with match data
            labels: Series with outcome labels (HOME, DRAW, AWAY)

        Returns:
            X: Feature matrix (n_samples, n_features)
            y: Label array
        """
        features_list = []

        for _, match in matches.iterrows():
            features = self.extract_features(
                home_team_data=match['home_team'],
                away_team_data=match['away_team'],
                h2h_data=match.get('h2h', []),
                injury_data=match.get('injuries', {}),
                weather_data=match.get('weather', {}),
                odds_data=match.get('odds', {}),
            )
            features_list.append(features)

        X = np.array(features_list)
        y = labels.map({'HOME': 0, 'DRAW': 1, 'AWAY': 2}).values

        return X, y

    def get_feature_names(self) -> List[str]:
        """Return list of feature names."""
        return self.feature_names.copy()


if __name__ == '__main__':
    # Example usage
    engineer = FeatureEngineer()
    print(f"Total features: {len(engineer.get_feature_names())}")
    print("\nFeature names:")
    for i, name in enumerate(engineer.get_feature_names()):
        print(f"  {i}: {name}")
