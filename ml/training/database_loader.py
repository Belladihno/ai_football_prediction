"""
Database Loader for Football Prediction ML Training

This module handles loading historical match data from PostgreSQL
for training the prediction models.

It provides:
- Database connection management
- Historical match data query
- Feature extraction from raw data
- Data preprocessing and validation
"""

import os
import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional
from datetime import datetime, timedelta

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False
    print("[WARNING] psycopg2 not installed. Database loading disabled.")

try:
    from dotenv import load_dotenv
    from pathlib import Path
    
    # Start from current file location
    current_path = Path(__file__).resolve()
    
    # Search for .env in parent directories
    env_path = None
    for parent in current_path.parents:
        if (parent / '.env').exists():
            env_path = parent / '.env'
            break
            
    if env_path:
        load_dotenv(env_path)
        print(f"[INFO] Loaded environment from: {env_path}")
    else:
        print("[WARNING] .env file not found in parent directories")
        
except ImportError:
    print("[WARNING] python-dotenv not installed. Environment variables must be set manually.")


class DatabaseConfig:
    """Database configuration from environment variables."""
    
    def __init__(self):
        self.host = os.environ.get('DB_HOST', 'localhost')
        self.port = int(os.environ.get('DB_PORT', 5432))
        self.database = os.environ.get('DB_NAME', 'football_prediction')
        self.username = os.environ.get('DB_USERNAME', 'postgres')
        self.password = os.environ.get('DB_PASSWORD', '')
    
    def to_dict(self) -> Dict:
        return {
            'host': self.host,
            'port': self.port,
            'database': self.database,
            'user': self.username,
            'password': self.password,
        }


class DatabaseLoader:
    """
    Load training data from PostgreSQL database.
    
    This class queries historical match data and transforms it
    into features suitable for ML training.
    """
    
    def __init__(self, config: Optional[DatabaseConfig] = None):
        """
        Initialize database loader.
        
        Args:
            config: Database configuration. If None, uses environment variables.
        """
        self.config = config or DatabaseConfig()
        self.connection = None
        
    def connect(self) -> bool:
        """
        Establish database connection.
        
        Returns:
            True if connection successful, False otherwise
        """
        if not HAS_PSYCOPG2:
            print("[ERROR] psycopg2 not available. Install with: pip install psycopg2-binary")
            return False
            
        try:
            self.connection = psycopg2.connect(**self.config.to_dict())
            print(f"[OK] Connected to database: {self.config.database}")
            return True
        except Exception as e:
            print(f"[ERROR] Database connection failed: {e}")
            return False
    
    def disconnect(self) -> None:
        """Close database connection."""
        if self.connection:
            self.connection.close()
            self.connection = None
            print("[OK] Database connection closed")
    
    def load_finished_matches(
        self,
        min_date: Optional[datetime] = None,
        max_date: Optional[datetime] = None,
        leagues: Optional[List[str]] = None,
        limit: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Load finished matches with results.
        
        Args:
            min_date: Minimum match date
            max_date: Maximum match date  
            leagues: List of league codes to include (e.g., ['PL', 'PD'])
            limit: Maximum number of matches to return
            
        Returns:
            DataFrame with match data
        """
        if not self.connection:
            if not self.connect():
                return pd.DataFrame()
        
        # Build query
        query = """
            SELECT 
                f.id,
                f."externalId",
                f.kickoff,
                f.matchday,
                f.status,
                f."homeGoals",
                f."awayGoals",
                f.venue,
                l.code as league_code,
                l.name as league_name,
                ht.id as home_team_id,
                ht.name as home_team_name,
                at.id as away_team_id,
                at.name as away_team_name
            FROM fixtures f
            JOIN leagues l ON f."leagueId" = l.id
            JOIN teams ht ON f."homeTeamId" = ht.id
            JOIN teams at ON f."awayTeamId" = at.id
            WHERE f.status = 'FINISHED'
            AND f."homeGoals" IS NOT NULL
            AND f."awayGoals" IS NOT NULL
        """
        
        params = []
        
        if min_date:
            query += " AND f.kickoff >= %s"
            params.append(min_date)
            
        if max_date:
            query += " AND f.kickoff <= %s"
            params.append(max_date)
            
        if leagues:
            query += " AND l.code = ANY(%s)"
            params.append(leagues)
            
        query += " ORDER BY f.kickoff DESC"
        
        if limit:
            query += " LIMIT %s"
            params.append(limit)
        
        try:
            with self.connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query, params)
                rows = cursor.fetchall()
                
            df = pd.DataFrame(rows)
            print(f"[OK] Loaded {len(df)} finished matches")
            return df
            
        except Exception as e:
            print(f"[ERROR] Failed to load matches: {e}")
            return pd.DataFrame()
    
    def load_team_stats(self, team_id: str, before_date: datetime) -> Dict:
        """
        Load team statistics before a specific date.
        
        Args:
            team_id: Team ID
            before_date: Get stats from matches before this date
            
        Returns:
            Dictionary with team statistics
        """
        if not self.connection:
            return {}
            
        # Get last 10 matches for form calculation
        query = """
            SELECT 
                f.kickoff,
                f."homeGoals",
                f."awayGoals",
                CASE 
                    WHEN f."homeTeamId" = %s THEN 'HOME'
                    ELSE 'AWAY'
                END as venue,
                s.position as league_position,
                s.points,
                s.won,
                s.drawn,
                s.lost,
                s."goalsFor",
                s."goalsAgainst"
            FROM fixtures f
            LEFT JOIN standings s ON f."leagueId" = s."leagueId" 
                AND (f."homeTeamId" = s."teamId" OR f."awayTeamId" = s."teamId")
            WHERE (f."homeTeamId" = %s OR f."awayTeamId" = %s)
            AND f.status = 'FINISHED'
            AND f.kickoff < %s
            ORDER BY f.kickoff DESC
            LIMIT 10
        """
        
        try:
            with self.connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query, [team_id, team_id, team_id, before_date])
                matches = cursor.fetchall()
                
            if not matches:
                return self._default_team_stats()
                
            return self._calculate_team_stats(matches, team_id)
            
        except Exception as e:
            print(f"[WARNING] Failed to load team stats: {e}")
            return self._default_team_stats()
    
    def _calculate_team_stats(self, matches: List[Dict], team_id: str) -> Dict:
        """Calculate team statistics from match history."""
        stats = {
            'matches_played': len(matches),
            'wins': 0,
            'draws': 0,
            'losses': 0,
            'goals_scored': 0,
            'goals_conceded': 0,
            'points': 0,
            'form': '',  # W/D/L string
            'win_streak': 0,
            'unbeaten_streak': 0,
        }
        
        current_streak = 0
        unbeaten = 0
        
        for match in matches:
            is_home = match['venue'] == 'HOME'
            team_goals = match['homeGoals'] if is_home else match['awayGoals']
            opp_goals = match['awayGoals'] if is_home else match['homeGoals']
            
            stats['goals_scored'] += team_goals
            stats['goals_conceded'] += opp_goals
            
            if team_goals > opp_goals:
                stats['wins'] += 1
                stats['points'] += 3
                stats['form'] += 'W'
                current_streak += 1
                unbeaten += 1
            elif team_goals == opp_goals:
                stats['draws'] += 1
                stats['points'] += 1
                stats['form'] += 'D'
                current_streak = 0
                unbeaten += 1
            else:
                stats['losses'] += 1
                stats['form'] += 'L'
                current_streak = 0
                unbeaten = 0
                
        stats['win_streak'] = current_streak
        stats['unbeaten_streak'] = unbeaten
        stats['form'] = stats['form'][:5]  # Last 5 results
        
        # Calculate per-game stats
        if stats['matches_played'] > 0:
            stats['points_per_game'] = stats['points'] / stats['matches_played']
            stats['goals_per_game'] = stats['goals_scored'] / stats['matches_played']
            stats['goals_conceded_per_game'] = stats['goals_conceded'] / stats['matches_played']
        else:
            stats['points_per_game'] = 0
            stats['goals_per_game'] = 0
            stats['goals_conceded_per_game'] = 0
            
        # Get league position from first match (most recent)
        if matches and matches[0].get('league_position'):
            stats['league_position'] = matches[0]['league_position']
        else:
            stats['league_position'] = 10  # Default middle
            
        return stats
    
    def _default_team_stats(self) -> Dict:
        """Return default team stats when no data available."""
        return {
            'matches_played': 0,
            'wins': 0,
            'draws': 0,
            'losses': 0,
            'goals_scored': 0,
            'goals_conceded': 0,
            'points': 0,
            'form': 'DDDDD',
            'win_streak': 0,
            'unbeaten_streak': 0,
            'points_per_game': 1.0,
            'goals_per_game': 1.0,
            'goals_conceded_per_game': 1.0,
            'league_position': 10,
        }
    
    def load_head_to_head(
        self,
        team1_id: str,
        team2_id: str,
        before_date: datetime,
        limit: int = 5
    ) -> List[Dict]:
        """
        Load head-to-head history between two teams.
        
        Args:
            team1_id: First team ID
            team2_id: Second team ID
            before_date: Get H2H from before this date
            limit: Maximum number of matches
            
        Returns:
            List of H2H match results
        """
        if not self.connection:
            return []
            
        query = """
            SELECT 
                f.kickoff,
                f."homeGoals",
                f."awayGoals",
                f."homeTeamId",
                f."awayTeamId"
            FROM fixtures f
            WHERE ((f."homeTeamId" = %s AND f."awayTeamId" = %s)
                OR (f."homeTeamId" = %s AND f."awayTeamId" = %s))
            AND f.status = 'FINISHED'
            AND f.kickoff < %s
            ORDER BY f.kickoff DESC
            LIMIT %s
        """
        
        try:
            with self.connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query, [team1_id, team2_id, team2_id, team1_id, before_date, limit])
                matches = cursor.fetchall()
                
            h2h = []
            for match in matches:
                result = {
                    'home_team_id': match['homeTeamId'],
                    'away_team_id': match['awayTeamId'],
                    'home_goals': match['homeGoals'],
                    'away_goals': match['awayGoals'],
                }
                
                if match['homeGoals'] > match['awayGoals']:
                    result['result'] = 'HOME_WIN'
                elif match['homeGoals'] < match['awayGoals']:
                    result['result'] = 'AWAY_WIN'
                else:
                    result['result'] = 'DRAW'
                    
                h2h.append(result)
                
            return h2h
            
        except Exception as e:
            print(f"[WARNING] Failed to load H2H: {e}")
            return []
    
    def prepare_training_data(
        self,
        min_date: Optional[datetime] = None,
        leagues: Optional[List[str]] = None,
        limit: Optional[int] = None
    ) -> Tuple[np.ndarray, np.ndarray]:
        """
        Prepare complete training dataset.
        
        This loads matches and extracts features for each one.
        
        Args:
            min_date: Minimum match date
            leagues: List of league codes
            limit: Maximum matches
            
        Returns:
            X: Feature matrix (n_samples, 30)
            y: Labels (0=HOME, 1=DRAW, 2=AWAY)
        """
        # Load finished matches
        matches_df = self.load_finished_matches(
            min_date=min_date,
            leagues=leagues,
            limit=limit
        )
        
        if matches_df.empty:
            print("[WARNING] No matches loaded, returning empty arrays")
            return np.array([]), np.array([])
        
        # Import feature engineering
        from training.feature_engineering import FeatureEngineer
        engineer = FeatureEngineer()
        
        features_list = []
        labels = []
        
        print(f"[INFO] Extracting features from {len(matches_df)} matches...")
        
        for idx, match in matches_df.iterrows():
            try:
                # Get team stats before this match
                home_stats = self.load_team_stats(
                    match['home_team_id'],
                    match['kickoff']
                )
                away_stats = self.load_team_stats(
                    match['away_team_id'],
                    match['kickoff']
                )
                
                # Get H2H history
                h2h = self.load_head_to_head(
                    match['home_team_id'],
                    match['away_team_id'],
                    match['kickoff']
                )
                
                # Prepare data for feature extraction
                home_team_data = {
                    'id': match['home_team_id'],
                    'last_results': home_stats.get('form', ''),
                    'points_per_game': home_stats.get('points_per_game', 0),
                    'goals_scored_per_game': home_stats.get('goals_per_game', 0),
                    'league_position': home_stats.get('league_position', 10),
                    'goal_difference': home_stats.get('goals_scored', 0) - home_stats.get('goals_conceded', 0),
                    'xg': home_stats.get('goals_per_game', 1.5),  # Use goals as xG proxy
                    'days_since_last_match': 7,  # Default
                    'win_streak': home_stats.get('win_streak', 0),
                    'unbeaten_streak': home_stats.get('unbeaten_streak', 0),
                    'manager_tenure_days': 365,  # Default
                }
                
                away_team_data = {
                    'id': match['away_team_id'],
                    'last_results': away_stats.get('form', ''),
                    'points_per_game': away_stats.get('points_per_game', 0),
                    'goals_scored_per_game': away_stats.get('goals_per_game', 0),
                    'league_position': away_stats.get('league_position', 10),
                    'goal_difference': away_stats.get('goals_scored', 0) - away_stats.get('goals_conceded', 0),
                    'xg': away_stats.get('goals_per_game', 1.2),
                    'days_since_last_match': 7,
                    'win_streak': away_stats.get('win_streak', 0),
                    'unbeaten_streak': away_stats.get('unbeaten_streak', 0),
                    'manager_tenure_days': 365,
                }
                
                # Default injury, weather, and odds data
                injury_data = {'home_count': 0, 'away_count': 0, 'home_impact': 0, 'away_impact': 0}
                weather_data = {'impact': 0, 'temperature': 15}
                odds_data = {'home_prob': 0.45}
                
                # Extract features
                features = engineer.extract_features(
                    home_team_data,
                    away_team_data,
                    h2h,
                    injury_data,
                    weather_data,
                    odds_data
                )
                
                features_list.append(features)
                
                # Determine outcome
                if match['homeGoals'] > match['awayGoals']:
                    labels.append(0)  # HOME
                elif match['homeGoals'] < match['awayGoals']:
                    labels.append(2)  # AWAY
                else:
                    labels.append(1)  # DRAW
                    
            except Exception as e:
                print(f"[WARNING] Failed to extract features for match {match['id']}: {e}")
                continue
        
        X = np.array(features_list)
        y = np.array(labels)
        
        print(f"[OK] Prepared {len(X)} samples with {X.shape[1] if len(X) > 0 else 0} features")
        print(f"  Class distribution: HOME={sum(y==0)}, DRAW={sum(y==1)}, AWAY={sum(y==2)}")
        
        return X, y


def generate_synthetic_data(n_samples: int = 5000, random_state: int = 42) -> Tuple[np.ndarray, np.ndarray]:
    """
    Generate synthetic training data for testing.
    
    This is used when database is not available.
    
    Args:
        n_samples: Number of samples to generate
        random_state: Random seed
        
    Returns:
        X: Feature matrix
        y: Labels
    """
    print(f"[INFO] Generating {n_samples} synthetic samples...")
    
    np.random.seed(random_state)
    
    # Generate 30 features
    X = np.random.randn(n_samples, 30)
    
    # Generate labels with realistic patterns
    score = (
        X[:, 0] * 0.3 +   # Home form score
        X[:, 1] * -0.2 +  # Away form score (negative correlation)
        X[:, 2] * 0.2 +   # Home points per game
        X[:, 3] * -0.15 + # Away points per game
        X[:, 4] * 0.15 +  # Home goals per game
        X[:, 6] * 0.1 +   # Home league position (lower is better)
        X[:, 7] * -0.1 +  # Away league position
        np.random.randn(n_samples) * 0.5  # Noise
    )
    
    # Convert to class probabilities
    prob_home = 1 / (1 + np.exp(-score))
    prob_draw = 0.26 + np.random.rand(n_samples) * 0.06  # ~26-32%
    prob_away = 1 - prob_home - prob_draw
    prob_away = np.maximum(prob_away, 0.05)
    
    # Normalize
    total = prob_home + prob_draw + prob_away
    prob_home /= total
    prob_draw /= total
    prob_away /= total
    
    # Sample labels based on probabilities
    probs = np.column_stack([prob_home, prob_draw, prob_away])
    y = np.array([np.random.choice([0, 1, 2], p=p) for p in probs])
    
    print(f"[OK] Generated {n_samples} samples")
    print(f"  Class distribution: HOME={sum(y==0)}, DRAW={sum(y==1)}, AWAY={sum(y==2)}")
    
    return X, y


if __name__ == '__main__':
    print("Database Loader Module")
    print("=" * 50)
    
    # Test synthetic data generation
    X, y = generate_synthetic_data(1000)
    print(f"\nSynthetic data shape: X={X.shape}, y={y.shape}")
    
    # Test database connection (if configured)
    print("\n" + "=" * 50)
    print("Testing database connection...")
    
    loader = DatabaseLoader()
    if loader.connect():
        matches = loader.load_finished_matches(limit=10)
        if not matches.empty:
            print(f"\nSample match:")
            print(matches.iloc[0])
        loader.disconnect()
    else:
        print("Database not available. Use synthetic data for testing.")
