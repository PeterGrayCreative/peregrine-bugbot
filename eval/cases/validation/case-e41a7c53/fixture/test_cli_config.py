import unittest

from cli_config import resolve_config


class CliConfigTests(unittest.TestCase):
    def test_cli_value_overrides_environment(self):
        self.assertEqual(resolve_config(5, {"SHUTDOWN_GRACE_SECONDS": "60"}).shutdown_grace_seconds, 5)

    def test_zero_disables_grace_period(self):
        self.assertEqual(resolve_config(0, {"SHUTDOWN_GRACE_SECONDS": "60"}).shutdown_grace_seconds, 0)

    def test_environment_is_used_when_cli_is_absent(self):
        self.assertEqual(resolve_config(None, {"SHUTDOWN_GRACE_SECONDS": "60"}).shutdown_grace_seconds, 60)


if __name__ == "__main__":
    unittest.main()
