from shop.pricing import total


def test_total_sums_prices() -> None:
    assert total([1.0, 2.0]) == 3.0


def test_total_applies_tax() -> None:
    assert total([10.0], 0.2) == 12.0
