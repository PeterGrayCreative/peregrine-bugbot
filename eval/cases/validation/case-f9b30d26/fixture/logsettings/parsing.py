from collections.abc import Mapping

from .model import HandlerSpec, LoggingSettings

VALID_LEVELS = frozenset({"debug", "info", "warning", "error"})
VALID_FORMATS = frozenset({"plain", "json"})


def normalize_level(raw: str | None) -> str:
    if raw is None:
        return "info"
    normalized = raw.strip().casefold()
    if normalized not in VALID_LEVELS:
        raise ValueError(f"unsupported log level: {raw}")
    return normalized


def parse_boolean(raw: str | None, default: bool) -> bool:
    if raw is None:
        return default
    normalized = raw.strip().casefold()
    if normalized in {"1", "true", "yes"}:
        return True
    if normalized in {"0", "false", "no"}:
        return False
    raise ValueError(f"unsupported boolean value: {raw}")


def parse_format(raw: str | None) -> str:
    normalized = "plain" if raw is None else raw.strip().casefold()
    if normalized not in VALID_FORMATS:
        raise ValueError(f"unsupported log format: {raw}")
    return normalized


def parse_handlers(raw: str | None, default_level: str) -> tuple[HandlerSpec, ...]:
    if raw is None or not raw.strip():
        return (HandlerSpec(name="console", kind="console", level=default_level),)
    handlers: list[HandlerSpec] = []
    for index, encoded in enumerate(raw.split(","), start=1):
        parts = [part.strip() for part in encoded.split(":")]
        kind = parts[0]
        if kind == "console" and len(parts) in {1, 2}:
            destination = None
            level = normalize_level(parts[1] if len(parts) == 2 else default_level)
        elif kind == "file" and len(parts) in {2, 3} and parts[1]:
            destination = parts[1]
            level = normalize_level(parts[2] if len(parts) == 3 else default_level)
        else:
            raise ValueError(f"unsupported handler definition: {encoded}")
        handlers.append(HandlerSpec(name=f"{kind}-{index}", kind=kind, level=level, destination=destination))
    return tuple(handlers)


def load_settings(environment: Mapping[str, str]) -> LoggingSettings:
    level = normalize_level(environment.get("LOG_LEVEL"))
    return LoggingSettings(
        level=level,
        format_name=parse_format(environment.get("LOG_FORMAT")),
        propagate=parse_boolean(environment.get("LOG_PROPAGATE"), False),
        handlers=parse_handlers(environment.get("LOG_HANDLERS"), level),
    )
