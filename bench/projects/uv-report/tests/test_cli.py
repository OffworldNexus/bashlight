from pathlib import Path

from report.cli import format_rows, load_rows

DATA = Path(__file__).parent.parent / "data.csv"


def test_load_rows_reads_the_csv() -> None:
    rows = load_rows(DATA)
    assert rows[0]["city"] == "Paris"
    assert len(rows) == 3


def test_format_rows_renders_every_field() -> None:
    text = format_rows([{"a": "1", "b": "2"}])
    assert "a" in text
    assert "b" in text
    assert "1" in text
