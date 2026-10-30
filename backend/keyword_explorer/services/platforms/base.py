"""Abstract Base Platform Suggestion Fetcher."""

from abc import ABC, abstractmethod
from typing import List
import httpx


class BasePlatformFetcher(ABC):
    """Abstract base class for all suggestion source fetchers."""

    platform_id: str
    display_name: str
    category: str
    is_free: bool = True
    description: str

    @abstractmethod
    async def fetch_suggestions(
        self,
        client: httpx.AsyncClient,
        query: str,
        language: str,
        country: str,
    ) -> List[str]:
        """
        Fetch suggestions for a single query.
        Returns a list of suggestion strings.
        Must catch its own exceptions and return empty list on failure.
        """
        pass

