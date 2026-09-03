import unittest

from page_response import Page, serialize_page


class PageResponseTests(unittest.TestCase):
    def test_wire_keys_follow_version_one_contract(self):
        self.assertEqual(
            serialize_page(Page(items=["a"], next_cursor="token-2")),
            {"items": ["a"], "next_cursor": "token-2"},
        )

    def test_terminal_page_retains_nullable_cursor_field(self):
        self.assertEqual(
            serialize_page(Page(items=[], next_cursor=None)),
            {"items": [], "next_cursor": None},
        )


if __name__ == "__main__":
    unittest.main()
