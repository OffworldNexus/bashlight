from app.commands import hello, main


def test_hello_greets(capsys) -> None:
    assert hello(["Ada"]) == 0
    assert "Ada" in capsys.readouterr().out


def test_main_lists_commands(capsys) -> None:
    assert main([]) == 0
    assert "hello" in capsys.readouterr().out
