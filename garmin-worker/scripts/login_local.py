"""
Interactive local Garmin login via garth (handles the MFA prompt).

Usage (from garmin-worker/):
    uv run python scripts/login_local.py

Saves tokens to ./garth-tokens (override with GARTH_HOME). Upload them to
the Fly volume afterwards:

    fly ssh console -a kadenz-garmin-worker -C "mkdir -p /data/garth"
    fly ssh sftp shell -a kadenz-garmin-worker
    >> put garth-tokens/oauth1_token.json /data/garth/oauth1_token.json
    >> put garth-tokens/oauth2_token.json /data/garth/oauth2_token.json

Then restart the machine so the worker resumes the session:
    fly machine restart -a kadenz-garmin-worker
"""

import getpass
import os
import warnings

with warnings.catch_warnings():
    warnings.simplefilter("ignore", DeprecationWarning)
    import garth


def main() -> None:
    home = os.environ.get("GARTH_HOME", os.path.join(os.getcwd(), "garth-tokens"))
    email = os.environ.get("GARMIN_EMAIL") or input("Garmin email: ")
    password = os.environ.get("GARMIN_PASSWORD") or getpass.getpass(
        "Garmin password: "
    )
    # garth prompts on stdin for the MFA code when the account requires it
    garth.login(email, password)
    garth.save(home)
    print(f"Tokens saved to {home}")
    print("Files:", ", ".join(sorted(os.listdir(home))))


if __name__ == "__main__":
    main()
