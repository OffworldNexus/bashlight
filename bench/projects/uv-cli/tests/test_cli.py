from uvcli.cli import greet, main


def test_greet_prints_a_greeting(capsys) -> None:
    assert greet(["Ada"]) == 0
    assert "Ada" in capsys.readouterr().out


def test_main_rejects_an_unknown_subcommand(capsys) -> None:
    assert main(["nope"]) == 2
    assert "usage" in capsys.readouterr().err
