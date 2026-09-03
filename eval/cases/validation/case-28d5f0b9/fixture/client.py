from dataclasses import dataclass
from typing import Any, Protocol


class Response(Protocol):
    status_code: int

    def json(self) -> Any: ...


@dataclass
class ApiClient:
    transport: Any

    def delete_widget(self, widget_id: str) -> None:
        response: Response = self.transport.delete(f"/widgets/{widget_id}")
        if not 200 <= response.status_code < 300:
            raise RuntimeError(f"delete failed with {response.status_code}")
        response.json()
