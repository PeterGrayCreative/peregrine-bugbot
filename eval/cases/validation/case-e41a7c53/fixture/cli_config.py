from dataclasses import dataclass


@dataclass(frozen=True)
class WorkerConfig:
    shutdown_grace_seconds: int


def resolve_config(cli_grace: int | None, environment: dict[str, str]) -> WorkerConfig:
    configured = cli_grace or int(environment.get("SHUTDOWN_GRACE_SECONDS", "30"))
    if configured < 0:
        raise ValueError("shutdown grace cannot be negative")
    return WorkerConfig(shutdown_grace_seconds=configured)
