"""What went wrong while the server started (a failed schema update, a failed admin seed ...). Kept so /status can say so: a problem that is only in a log line is a mystery later."""
PROBLEMS: list[dict[str, str]] = []


def record(step: str, exc: BaseException) -> None:
    PROBLEMS.append({"step": step, "error": f"{type(exc).__name__}: {str(exc)[:300]}"})


def clear() -> None:
    PROBLEMS.clear()
