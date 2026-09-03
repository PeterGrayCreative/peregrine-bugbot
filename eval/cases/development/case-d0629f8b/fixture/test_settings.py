import unittest

from settings import load_port


class SettingsTests(unittest.TestCase):
    def test_missing_value_uses_default(self):
        self.assertEqual(load_port({}), 8080)

    def test_empty_value_is_rejected(self):
        with self.assertRaises(ValueError):
            load_port({"SERVICE_PORT": ""})

    def test_valid_value_is_loaded(self):
        self.assertEqual(load_port({"SERVICE_PORT": "9000"}), 9000)


if __name__ == "__main__":
    unittest.main()
