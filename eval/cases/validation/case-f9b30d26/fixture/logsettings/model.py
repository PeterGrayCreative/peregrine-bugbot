from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class HandlerSpec:
    name: str
    kind: Literal["console", "file"]
    level: str
    destination: str | None = None


@dataclass(frozen=True)
class LoggingSettings:
    level: str
    format_name: Literal["plain", "json"]
    propagate: bool
    handlers: tuple[HandlerSpec, ...]
