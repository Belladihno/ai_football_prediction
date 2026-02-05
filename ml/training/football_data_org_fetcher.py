"""
Historical Data Fetcher for football-data.org

Fetches season-based match data from football-data.org and seeds the local
PostgreSQL database for training.
"""

import json
import os
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from training.database_loader import DatabaseConfig

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False


class FootballDataOrgFetcher:
    """
    Fetch historical matches from football-data.org and seed the database.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        min_interval_seconds: float = 6.0,
    ):
        self.api_key = api_key or os.environ.get('FOOTBALL_DATA_API_KEY', '')
        self.base_url = base_url or os.environ.get('FOOTBALL_DATA_BASE_URL', 'https://api.football-data.org/v4')
        self.min_interval_seconds = min_interval_seconds
        self._last_request_at = 0.0

    def can_fetch(self) -> bool:
        return bool(self.api_key)

    def _throttle(self) -> None:
        elapsed = time.time() - self._last_request_at
        if elapsed < self.min_interval_seconds:
            time.sleep(self.min_interval_seconds - elapsed)
        self._last_request_at = time.time()

    def _get(self, path: str, params: Optional[Dict] = None) -> Dict:
        if not self.api_key:
            raise ValueError("FOOTBALL_DATA_API_KEY not configured")

        query = f"?{urlencode(params)}" if params else ""
        url = f"{self.base_url}{path}{query}"

        self._throttle()
        req = Request(url, headers={'X-Auth-Token': self.api_key})

        with urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))

    def fetch_matches(self, league_code: str, season: int) -> List[Dict]:
        data = self._get(
            f"/competitions/{league_code}/matches",
            params={
                "season": season,
                "status": "FINISHED",
            },
        )
        return data.get('matches', [])

    def seed_historical_matches(
        self,
        league_codes: List[str],
        seasons: List[int],
    ) -> Tuple[int, int]:
        """
        Fetch matches and insert into database.

        Returns:
            Tuple of (matches_processed, matches_inserted)
        """
        if not HAS_PSYCOPG2:
            raise RuntimeError("psycopg2 not installed. Install psycopg2-binary to seed the database.")

        config = DatabaseConfig()
        connection = psycopg2.connect(**config.to_dict())
        connection.autocommit = False

        total_processed = 0
        total_inserted = 0

        try:
            with connection.cursor(cursor_factory=RealDictCursor) as cursor:
                for league_code in league_codes:
                    for season in seasons:
                        matches = self.fetch_matches(league_code, season)
                        if not matches:
                            continue

                        league_id = self._upsert_league(cursor, matches[0].get('competition', {}))

                        for match in matches:
                            total_processed += 1
                            inserted = self._upsert_match(cursor, match, league_id, season)
                            total_inserted += 1 if inserted else 0

                        connection.commit()
                        print(f"[OK] Seeded {len(matches)} matches for {league_code} season {season}")

        except Exception as exc:
            connection.rollback()
            print(f"[ERROR] Historical data seed failed: {exc}")
        finally:
            connection.close()

        return total_processed, total_inserted

    def _upsert_league(self, cursor, competition: Dict) -> str:
        code = competition.get('code') or ''
        name = competition.get('name') or code
        country = competition.get('area', {}).get('name')
        emblem = competition.get('emblem')

        cursor.execute(
            """
            INSERT INTO leagues (code, name, country, "emblemUrl")
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (code) DO UPDATE
            SET name = EXCLUDED.name,
                country = COALESCE(EXCLUDED.country, leagues.country),
                "emblemUrl" = COALESCE(EXCLUDED."emblemUrl", leagues."emblemUrl")
            RETURNING id
            """,
            (code, name, country, emblem),
        )
        return cursor.fetchone()['id']

    def _upsert_team(self, cursor, team: Dict, league_id: str) -> str:
        cursor.execute(
            """
            INSERT INTO teams ("externalId", name, "shortName", "tla", "crestUrl", venue, "leagueId")
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT ("externalId") DO UPDATE
            SET name = EXCLUDED.name,
                "shortName" = COALESCE(EXCLUDED."shortName", teams."shortName"),
                "tla" = COALESCE(EXCLUDED."tla", teams."tla"),
                "crestUrl" = COALESCE(EXCLUDED."crestUrl", teams."crestUrl"),
                venue = COALESCE(EXCLUDED.venue, teams.venue),
                "leagueId" = COALESCE(EXCLUDED."leagueId", teams."leagueId")
            RETURNING id
            """,
            (
                team.get('id'),
                team.get('name'),
                team.get('shortName'),
                team.get('tla'),
                team.get('crest'),
                team.get('venue'),
                league_id,
            ),
        )
        return cursor.fetchone()['id']

    def _format_season(self, match: Dict, fallback: int) -> str:
        season = match.get('season') or {}
        start = season.get('startDate')
        end = season.get('endDate')
        if start and end:
            return f"{start[:4]}/{end[:4]}"
        return str(fallback)

    def _parse_datetime(self, value: Optional[str]) -> Optional[datetime]:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace('Z', '+00:00'))
        except Exception:
            return None

    def _upsert_match(self, cursor, match: Dict, league_id: str, fallback_season: int) -> bool:
        home_team = match.get('homeTeam') or {}
        away_team = match.get('awayTeam') or {}
        home_team_id = self._upsert_team(cursor, home_team, league_id)
        away_team_id = self._upsert_team(cursor, away_team, league_id)

        score = match.get('score') or {}
        full_time = score.get('fullTime') or {}
        half_time = score.get('halfTime') or {}
        extra_time = score.get('extraTime') or {}
        penalties = score.get('penalties') or {}

        season_label = self._format_season(match, fallback_season)

        cursor.execute(
            """
            INSERT INTO fixtures (
                "externalId",
                kickoff,
                matchday,
                status,
                "homeGoals",
                "awayGoals",
                "homeHalfTimeGoals",
                "awayHalfTimeGoals",
                "homeExtraTimeGoals",
                "awayExtraTimeGoals",
                "homePenalties",
                "awayPenalties",
                season,
                "homeTeamId",
                "awayTeamId",
                "leagueId"
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT ("externalId") DO UPDATE
            SET kickoff = EXCLUDED.kickoff,
                matchday = EXCLUDED.matchday,
                status = EXCLUDED.status,
                "homeGoals" = EXCLUDED."homeGoals",
                "awayGoals" = EXCLUDED."awayGoals",
                "homeHalfTimeGoals" = EXCLUDED."homeHalfTimeGoals",
                "awayHalfTimeGoals" = EXCLUDED."awayHalfTimeGoals",
                "homeExtraTimeGoals" = EXCLUDED."homeExtraTimeGoals",
                "awayExtraTimeGoals" = EXCLUDED."awayExtraTimeGoals",
                "homePenalties" = EXCLUDED."homePenalties",
                "awayPenalties" = EXCLUDED."awayPenalties",
                season = EXCLUDED.season,
                "homeTeamId" = EXCLUDED."homeTeamId",
                "awayTeamId" = EXCLUDED."awayTeamId",
                "leagueId" = EXCLUDED."leagueId"
            RETURNING id
            """,
            (
                match.get('id'),
                self._parse_datetime(match.get('utcDate')),
                match.get('matchday'),
                match.get('status'),
                full_time.get('home'),
                full_time.get('away'),
                half_time.get('home'),
                half_time.get('away'),
                extra_time.get('home'),
                extra_time.get('away'),
                penalties.get('home'),
                penalties.get('away'),
                season_label,
                home_team_id,
                away_team_id,
                league_id,
            ),
        )
        return cursor.fetchone() is not None
