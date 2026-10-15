"""Verify the exported app's signature, HealthKit permissions and bundled icon before uploading."""
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import zipfile


def main():
    exports = list((Path(os.environ["RUNNER_TEMP"]) / "export").glob("*.ipa"))
    if len(exports) != 1:
        raise SystemExit("Expected exactly one exported iPhone app")
    with tempfile.TemporaryDirectory() as directory:
        with zipfile.ZipFile(exports[0]) as archive:
            archive.extractall(directory)
        apps = list((Path(directory) / "Payload").glob("*.app"))
        if len(apps) != 1:
            raise SystemExit("Expected one app in the exported package")
        app = apps[0]
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
        signed = subprocess.run(["codesign", "--display", "--entitlements", "-", "--xml", str(app)],
                                capture_output=True, check=True)
        entitlements = plistlib.loads(signed.stdout)
        assert entitlements.get("com.apple.developer.healthkit") is True, "Export lost HealthKit permission"
        assert entitlements.get("com.apple.developer.healthkit.background-delivery") is True, "Export lost background permission"
        assert entitlements.get("aps-environment") == "production", "Export lost production push entitlement"
        assert entitlements.get("application-identifier") == os.environ["TEAM"] + ".com.kinetta.app", "Unexpected app signing identity"
        assert entitlements.get("get-task-allow") is not True, "Export uses a development profile"
        profile = subprocess.run(["security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")],
                                 capture_output=True, check=True)
        profile = plistlib.loads(profile.stdout)
        assert "ProvisionedDevices" not in profile, "Export is restricted to registered development devices"
        assert profile["Entitlements"].get("beta-reports-active") is True, "Export is not provisioned for TestFlight"
        info = plistlib.loads((app / "Info.plist").read_bytes())
        assert info["CFBundleIdentifier"] == "com.kinetta.app", "Unexpected bundle ID"
        assert info.get("CFBundleIcons", {}).get("CFBundlePrimaryIcon", {}).get("CFBundleIconName") == "AppIcon", "App icon missing from exported metadata"
    print("Export signature, TestFlight profile, HealthKit/background entitlements and app icon verified.")


if __name__ == "__main__":
    main()
