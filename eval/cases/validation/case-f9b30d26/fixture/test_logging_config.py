import json
import unittest
from pathlib import Path

from logging_config import (
    build_dict_config,
    load_profile,
    load_settings,
    normalize_level,
    parse_boolean,
    parse_format,
    parse_handlers,
)


class LoggingConfigTests(unittest.TestCase):
    def test_defaults(self):
        settings = load_settings({})
        self.assertEqual(settings.level, "info")
        self.assertEqual(settings.format_name, "plain")
        self.assertFalse(settings.propagate)
        self.assertEqual(settings.handlers[0].kind, "console")

    def test_normalizes_supported_level(self):
        self.assertEqual(normalize_level(" WARNING "), "warning")

    def test_rejects_unsupported_level(self):
        with self.assertRaises(ValueError):
            normalize_level("verbose")

    def test_loads_console_and_file_handlers(self):
        settings = load_settings(
            {
                "LOG_LEVEL": "warning",
                "LOG_FORMAT": "json",
                "LOG_PROPAGATE": "yes",
                "LOG_HANDLERS": "console:error,file:/var/log/service.log:info",
            }
        )
        self.assertTrue(settings.propagate)
        self.assertEqual([handler.kind for handler in settings.handlers], ["console", "file"])
        self.assertEqual(settings.handlers[1].destination, "/var/log/service.log")

    def test_rejects_invalid_handler(self):
        with self.assertRaises(ValueError):
            load_settings({"LOG_HANDLERS": "udp:localhost"})

    def test_legacy_boolean_parser_remains_public(self):
        self.assertTrue(parse_boolean(" yes ", False))
        self.assertFalse(parse_boolean(None, False))
        with self.assertRaises(ValueError):
            parse_boolean("sometimes", False)

    def test_legacy_format_parser_remains_public(self):
        self.assertEqual(parse_format(" JSON "), "json")
        with self.assertRaises(ValueError):
            parse_format("xml")

    def test_legacy_handler_parser_remains_public(self):
        handlers = parse_handlers("console:error,file:service.log", "warning")
        self.assertEqual([handler.kind for handler in handlers], ["console", "file"])
        self.assertEqual(handlers[1].level, "warning")

    def test_renders_logging_dictionary(self):
        rendered = build_dict_config(
            load_settings(
                {
                    "LOG_LEVEL": "debug",
                    "LOG_FORMAT": "json",
                    "LOG_HANDLERS": "console,file:service.log:warning",
                }
            )
        )
        self.assertEqual(rendered["root"], {"level": "DEBUG", "handlers": ["console-1", "file-2"]})
        self.assertEqual(rendered["handlers"]["file-2"]["filename"], "service.log")
        self.assertEqual(rendered["handlers"]["file-2"]["level"], "WARNING")
        self.assertEqual(rendered["handlers"]["console-1"]["formatter"], "json")

    def test_all_checked_in_profiles_are_loadable_and_self_identifying(self):
        profile_root = Path(__file__).parent / "logsettings" / "environments"
        profiles = sorted(profile_root.glob("*.json"))
        self.assertGreaterEqual(len(profiles), 36)
        for path in profiles:
            document = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(document["profile"], path.stem)
            settings = load_profile(path.stem)
            self.assertGreaterEqual(len(settings.handlers), 1)

    def test_profile_loader_rejects_paths_and_unknown_names(self):
        with self.assertRaises(ValueError):
            load_profile("../production")
        with self.assertRaises(ValueError):
            load_profile("missing-profile")


if __name__ == "__main__":
    unittest.main()
