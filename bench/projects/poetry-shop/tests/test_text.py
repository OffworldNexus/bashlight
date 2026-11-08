from shop.text import initials, shout


def test_shout_upper_cases() -> None:
    assert shout("hi") == "HI"


def test_initials_picks_first_letters() -> None:
    assert initials("Ada Lovelace") == "AL"


def test_initials_handles_blank() -> None:
    assert initials("   ") == ""
