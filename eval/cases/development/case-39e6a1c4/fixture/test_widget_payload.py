import unittest

from widget_payload import widget_payload


class WidgetPayloadTests(unittest.TestCase):
    def test_omits_absent_optional_label(self):
        self.assertEqual(widget_payload("w-1"), {"id": "w-1"})

    def test_preserves_empty_label(self):
        self.assertEqual(widget_payload("w-1", ""), {"id": "w-1", "label": ""})

    def test_includes_label(self):
        self.assertEqual(widget_payload("w-1", "alpha"), {"id": "w-1", "label": "alpha"})


if __name__ == "__main__":
    unittest.main()
