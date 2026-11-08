#!/usr/bin/env python3
"""A tiny management-style entry point for the project."""

import sys

from app.commands import main

if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
