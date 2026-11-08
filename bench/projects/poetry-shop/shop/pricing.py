"""A tiny pricing helper for the shop package."""


def total(prices: list[float], tax: float = 0.0) -> float:
    """Sum the prices and apply the tax rate, rounded to cents."""
    return round(sum(prices) * (1 + tax), 2)
