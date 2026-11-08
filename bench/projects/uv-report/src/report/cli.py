"""The ``report`` command line interface."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path


def load_rows(path: Path) -> list[dict[str, str]]:
    """Read a CSV file into a list of row dictionaries."""
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def format_rows(rows: list[dict[str, str]]) -> str:
    """Render the rows as tab-separated text, one line per row."""
    fields = list(rows[0]) if rows else []
    lines = ["\t".join(fields)]
    lines.extend("\t".join(row[field] for field in fields) for row in rows)
    return "\n".join(lines)


def main() -> None:
    """Entry point for the ``report`` script."""
    parser = argparse.ArgumentParser(prog="report")
    parser.add_argument("--data", default="data.csv", type=Path)
    args = parser.parse_args()
    print(format_rows(load_rows(args.data)))
