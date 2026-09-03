def widget_payload(widget_id: str, label: str | None = None) -> dict[str, str]:
    return {
        "id": widget_id,
        **({"label": label} if label is not None else {}),
    }
