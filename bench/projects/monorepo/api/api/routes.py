"""Route helpers for the API."""


def health() -> dict[str, str]:
    """Return a simple health payload."""
    return {"status": "ok"}
