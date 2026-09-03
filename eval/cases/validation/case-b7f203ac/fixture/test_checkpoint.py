import json
import tempfile
import unittest
from pathlib import Path

from checkpoint import save_checkpoint


class CheckpointTests(unittest.TestCase):
    def test_interrupted_write_preserves_last_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            path.write_text('{"offset": 10}')

            def interrupted(stream, value):
                stream.write('{"offset": ')
                raise OSError("disk full")

            with self.assertRaisesRegex(OSError, "disk full"):
                save_checkpoint(path, {"offset": 11}, interrupted)
            self.assertEqual(json.loads(path.read_text()), {"offset": 10})

    def test_completed_write_replaces_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            path.write_text('{"offset": 10}')
            save_checkpoint(path, {"offset": 11})
            self.assertEqual(json.loads(path.read_text()), {"offset": 11})


if __name__ == "__main__":
    unittest.main()
