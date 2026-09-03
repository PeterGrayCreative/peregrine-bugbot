import os


def load_port(environment: dict[str, str] | None = None) -> int:
    values = os.environ if environment is None else environment
    raw = values.get("SERVICE_PORT")
    if not raw:
        return 8080
    port = int(raw)
    if not 1 <= port <= 65535:
        raise ValueError("SERVICE_PORT must be between 1 and 65535")
    return port
