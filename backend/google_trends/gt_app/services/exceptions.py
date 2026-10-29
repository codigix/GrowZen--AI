class TrendsServiceError(Exception):
    """Raised when Google Trends data cannot be retrieved after retries."""


class TrendsUnavailableError(TrendsServiceError):
    """Raised when the upstream Google Trends service is unreachable or rate-limiting us."""


class InvalidTrendsRequestError(TrendsServiceError):
    """Raised when the request parameters are invalid (bad keyword/country/timeframe)."""
