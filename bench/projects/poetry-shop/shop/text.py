"""Small text helpers for the shop package."""


def shout(text: str) -> str:
    """Return the text in upper case."""
    return text.upper()


def initials(name: str) -> str:
    """Return the initials of a full name, or ``""`` for a blank name."""
    return "".join(part[0] for part in name.split() if part)
