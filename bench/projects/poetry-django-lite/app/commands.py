"""The command registry behind ``manage.py``."""

from __future__ import annotations

import sys
from collections.abc import Callable

Command = Callable[[list[str]], int]


def hello(argv: list[str]) -> int:
    """Print a greeting for the first argument, or the world."""
    who = argv[0] if argv else "world"
    print(f"hello, {who}")
    return 0


def show(argv: list[str]) -> int:
    """Print the project name."""
    print("inventory")
    return 0


COMMANDS: dict[str, Command] = {"hello": hello, "show": show}


def main(argv: list[str]) -> int:
    """Dispatch a command, or list the available ones when none is given."""
    if not argv:
        print("commands: " + ", ".join(sorted(COMMANDS)))
        return 0
    command = COMMANDS.get(argv[0])
    if command is None:
        print(f"unknown command: {argv[0]}", file=sys.stderr)
        return 2
    return command(argv[1:])
