from typing import Any

from .model import LoggingSettings


def build_dict_config(settings: LoggingSettings) -> dict[str, Any]:
    formatters: dict[str, dict[str, str]] = {
        "plain": {"format": "%(levelname)s %(name)s %(message)s"},
        "json": {"format": '{"level":"%(levelname)s","logger":"%(name)s","message":"%(message)s"}'},
    }
    handlers: dict[str, dict[str, Any]] = {}
    for spec in settings.handlers:
        if spec.kind == "console":
            handlers[spec.name] = {
                "class": "logging.StreamHandler",
                "level": spec.level.upper(),
                "formatter": settings.format_name,
                "stream": "ext://sys.stderr",
            }
        else:
            handlers[spec.name] = {
                "class": "logging.FileHandler",
                "level": spec.level.upper(),
                "formatter": settings.format_name,
                "filename": spec.destination,
                "encoding": "utf-8",
            }
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": formatters,
        "handlers": handlers,
        "root": {"level": settings.level.upper(), "handlers": [item.name for item in settings.handlers]},
        "loggers": {
            "service": {
                "level": settings.level.upper(),
                "handlers": [item.name for item in settings.handlers],
                "propagate": settings.propagate,
            }
        },
    }
