import json
from pathlib import Path

from .model import LoggingSettings
from .parsing import load_settings

PROFILE_ROOT = Path(__file__).with_name("environments")


def load_profile(name: str) -> LoggingSettings:
    if not name or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in name):
        raise ValueError("profile name must be a lowercase slug")
    path = PROFILE_ROOT / f"{name}.json"
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"unknown logging profile: {name}") from error
    if not isinstance(document, dict) or document.get("profile") != name:
        raise ValueError(f"invalid logging profile: {name}")
    environment = document.get("environment")
    if not isinstance(environment, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in environment.items()
    ):
        raise ValueError(f"invalid logging environment: {name}")
    return load_settings(environment)
