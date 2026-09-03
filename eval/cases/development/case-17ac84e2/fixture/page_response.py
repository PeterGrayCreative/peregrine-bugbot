from dataclasses import dataclass


@dataclass(frozen=True)
class Page:
    items: list[str]
    next_cursor: str | None


def serialize_page(page: Page) -> dict[str, object]:
    return {
        "items": page.items,
        "cursor": page.next_cursor,
    }
