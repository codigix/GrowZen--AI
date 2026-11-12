"""Errors that cross module boundaries.

DataUnavailable: the real data source for something is not set up (a missing key or connection). The app never fills the gap with sample or random
numbers: the caller shows the message, a route answers HTTP 503 {detail, code: "data_unavailable"}, a background job logs it and skips.
"""


class DataUnavailable(RuntimeError):
    """Real data cannot be fetched because a key or connection is missing. `message` says exactly what to set up."""

    code = "data_unavailable"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message
