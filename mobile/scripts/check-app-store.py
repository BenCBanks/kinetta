"""CI-only check: the signing key can read the expected app; never print credentials or app records."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b"=")


def raw_signature(der):
    # OpenSSL emits ASN.1 integers. ES256 JWTs require two fixed-width 32-byte integers.
    if len(der) < 2 or der[0] != 0x30 or der[1] != len(der) - 2:
        raise ValueError("Unexpected ES256 signature format")
    offset, parts = 2, []
    for _ in range(2):
        if offset + 2 > len(der) or der[offset] != 0x02:
            raise ValueError("Unexpected ES256 integer")
        length = der[offset + 1]
        value = der[offset + 2:offset + 2 + length]
        if not value or len(value) != length or value[0] & 0x80:
            raise ValueError("Invalid ES256 integer")
        number = int.from_bytes(value, "big")
        parts.append(number.to_bytes(32, "big"))
        offset += 2 + length
    if offset != len(der):
        raise ValueError("Trailing signature data")
    return b"".join(parts)


def token(key_path, key_id, issuer):
    now = int(time.time())
    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    claims = {"iss": issuer, "iat": now, "exp": now + 300, "aud": "appstoreconnect-v1"}
    message = b".".join(encode(json.dumps(x, separators=(",", ":")).encode()) for x in (header, claims))
    signed = subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(key_path)],
                            input=message, capture_output=True)
    if signed.returncode:
        raise ValueError("Apple key could not sign an API request; check the complete .p8 contents")
    return (message + b"." + encode(raw_signature(signed.stdout))).decode()


def main():
    try:
        jwt = token(Path(os.environ["RUNNER_TEMP"]) / "AuthKey.p8", os.environ["KEY_ID"], os.environ["ISSUER"])
        request = Request("https://api.appstoreconnect.apple.com/v1/apps?filter%5BbundleId%5D=com.kinetta.app&limit=2",
                          headers={"Authorization": "Bearer " + jwt})
        with urlopen(request, timeout=30) as response:
            apps = json.load(response).get("data", [])
        if len(apps) != 1 or apps[0].get("attributes", {}).get("bundleId") != "com.kinetta.app":
            print("::error::The API key cannot see exactly one com.kinetta.app app. Check the app record and key's team/access.")
            return 1
        print("App Store Connect API access verified for com.kinetta.app. No account records or credentials printed.")
        return 0
    except HTTPError as error:
        hints = {401: "Check that Key ID, Issuer ID and .p8 belong to the same active team key.",
                 403: "Check the API key's role and outstanding Apple agreements."}
        print(f"::error::App Store Connect app lookup returned HTTP {error.code}. " + hints.get(error.code, "Apple API request failed; retry or check Apple's service status."))
    except (URLError, TimeoutError):
        print("::error::App Store Connect could not be reached. No credentials printed.")
    except (ValueError, KeyError, OverflowError):
        print("::error::Apple API credentials or response could not be validated. Check the saved signing secrets.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
