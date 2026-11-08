"""Command line entry point for uv-cli."""

from __future__ import annotations

import sys
from collections.abc import Callable

Command = Callable[[list[str]], int]


def greet(argv: list[str]) -> int:
    """Print a greeting for the first argument, or the world."""
    name = argv[0] if argv else "world"
    print(f"hello, {name}")
    return 0


def echo(argv: list[str]) -> int:
    """Print each argument back on its own line."""
    for value in argv:
        print(value)
    return 0


COMMANDS: dict[str, Command] = {"greet": greet, "echo": echo}


def main(argv: list[str] | None = None) -> int:
    """Dispatch a subcommand, or print usage for an unknown one."""
    args = list(sys.argv[1:] if argv is None else argv)
    if not args or args[0] not in COMMANDS:
        names = ", ".join(sorted(COMMANDS))
        print(f"usage: uv-cli {{{names}}} [args...]", file=sys.stderr)
        return 2
    return COMMANDS[args[0]](args[1:])


if __name__ == "__main__":
    raise SystemExit(main())

