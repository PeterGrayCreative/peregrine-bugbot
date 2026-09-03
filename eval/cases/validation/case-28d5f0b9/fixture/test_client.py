import unittest

from client import ApiClient


class EmptyResponse:
    status_code = 204

    def json(self):
        raise ValueError("response body is empty")


class Transport:
    def delete(self, path):
        if path != "/widgets/w-1":
            raise AssertionError(path)
        return EmptyResponse()


class ApiClientTests(unittest.TestCase):
    def test_no_content_delete_is_successful(self):
        self.assertIsNone(ApiClient(Transport()).delete_widget("w-1"))


if __name__ == "__main__":
    unittest.main()
