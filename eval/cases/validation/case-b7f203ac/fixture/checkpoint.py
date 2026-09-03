import json
import os
from pathlib import Path
from typing import Callable, TextIO


Writer = Callable[[TextIO, dict[str, int]], None]


def write_json(stream: TextIO, value: dict[str, int]) -> None:
    json.dump(value, stream)


def save_checkpoint(path: Path, value: dict[str, int], writer: Writer = write_json) -> None:
    with path.open("w") as stream:
        writer(stream, value)
