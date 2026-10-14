"""Signing helper checks with an ephemeral test key and stand-in HTTP; no Apple requests."""
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location("preflight", Path(__file__).with_name("check-app-store.py"))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


class SigningChecks(unittest.TestCase):
    def test_jwt_signature_verifies_with_openssl(self):
        with tempfile.TemporaryDirectory() as directory:
            key, public, signature = (Path(directory) / name for name in ("key.pem", "public.pem", "signature.der"))
            subprocess.run(["openssl", "genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", str(key)], check=True, capture_output=True)
            subprocess.run(["openssl", "pkey", "-in", str(key), "-pubout", "-out", str(public)], check=True, capture_output=True)
            for _ in range(20):  # ECDSA's variable integer padding is randomized.
                jwt = preflight.token(key, "test-key", "test-issuer")
                head, payload, sig = jwt.split(".")
                claims = json.loads(base64.urlsafe_b64decode(payload + "=="))
                self.assertEqual(claims["aud"], "appstoreconnect-v1")
                self.assertEqual(claims["exp"] - claims["iat"], 300)
                raw = base64.urlsafe_b64decode(sig + "==")
                self.assertEqual(len(raw), 64)
                parts = []
                for number in (raw[:32], raw[32:]):
                    value = number.lstrip(b"\x00") or b"\x00"
                    if value[0] & 0x80:
                        value = b"\x00" + value
                    parts.append(b"\x02" + bytes([len(value)]) + value)
                sequence = b"".join(parts)
                signature.write_bytes(b"\x30" + bytes([len(sequence)]) + sequence)
                result = subprocess.run(["openssl", "dgst", "-sha256", "-verify", str(public), "-signature", str(signature)], input=(head + "." + payload).encode(), capture_output=True)
                self.assertEqual(result.returncode, 0)

    def test_access_and_errors_do_not_print_key_or_records(self):
        for data, expected in [({"data": [{"id": "private-app-id", "attributes": {"bundleId": "com.kinetta.app"}}]}, 0), ({"data": []}, 1)]:
            with patch.dict(os.environ, {"RUNNER_TEMP": "/tmp", "KEY_ID": "private-key-id", "ISSUER": "private-issuer"}), patch.object(preflight, "token", return_value="private-jwt"), patch.object(preflight, "urlopen", return_value=io.BytesIO(json.dumps(data).encode())), redirect_stdout(io.StringIO()) as output:
                self.assertEqual(preflight.main(), expected)
                self.assertNotIn("private-", output.getvalue())
        for status in (401, 403, 503):
            error = HTTPError("https://api.appstoreconnect.apple.com", status, "private-error", {}, None)
            with patch.dict(os.environ, {"RUNNER_TEMP": "/tmp", "KEY_ID": "private-key-id", "ISSUER": "private-issuer"}), patch.object(preflight, "token", return_value="private-jwt"), patch.object(preflight, "urlopen", side_effect=error), redirect_stdout(io.StringIO()) as output:
                self.assertEqual(preflight.main(), 1)
                self.assertIn(str(status), output.getvalue())
                self.assertNotIn("private-", output.getvalue())

    def test_bundled_icon_is_opaque_1024_png(self):
        catalog = Path(__file__).resolve().parents[1] / "ios/App/App/Assets.xcassets/AppIcon.appiconset"
        entry = json.loads((catalog / "Contents.json").read_text())["images"][0]
        data = (catalog / entry["filename"]).read_bytes()
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack(">II", data[16:24]), (1024, 1024))
        self.assertEqual((data[24], data[25]), (8, 2))  # RGB8, no alpha channel
        offset = 8
        while offset < len(data):
            length = int.from_bytes(data[offset:offset + 4], "big")
            self.assertNotEqual(data[offset + 4:offset + 8], b"tRNS")
            offset += length + 12


if __name__ == "__main__":
    unittest.main()
