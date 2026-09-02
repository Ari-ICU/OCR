#!/usr/bin/env python3
"""
Automated Gemini Project & API Key Generator
Creates real Google Cloud Projects, enables the Gemini / Generative Language API,
and generates authentic API keys across separate projects under your Google Account.

Prerequisites:
  1. brew install --cask google-cloud-sdk
  2. gcloud auth login
"""

import argparse
import json
import os
import random
import shutil
import string
import subprocess
import sys
import time
from typing import List, Optional, Tuple


def run_cmd(cmd: List[str], check: bool = True) -> Tuple[int, str, str]:
    """Runs a shell command and returns (returncode, stdout, stderr)."""
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if check and res.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\nError: {res.stderr.strip()}")
    return res.returncode, res.stdout.strip(), res.stderr.strip()


def check_gcloud_installed() -> bool:
    """Checks if gcloud CLI is available."""
    return shutil.which("gcloud") is not None


def check_gcloud_auth() -> Optional[str]:
    """Checks if the user is authenticated with gcloud. Returns the active account email or None."""
    code, stdout, _ = run_cmd(["gcloud", "auth", "list", "--format=json"], check=False)
    if code != 0 or not stdout:
        return None
    try:
        accounts = json.loads(stdout)
        for acc in accounts:
            if acc.get("status") == "ACTIVE":
                return acc.get("account")
    except Exception:
        pass
    return None


def generate_random_project_id(prefix: str = "pdf-ocr") -> str:
    """Generates a valid GCP project ID (6-30 chars, lowercase, digits, hyphens)."""
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    timestamp = int(time.time()) % 10000
    return f"{prefix}-{timestamp}-{suffix}"[:30]


def create_project_and_get_key(project_id: str, project_name: str, key_display_name: str = "Gemini-OCR-Key") -> Optional[str]:
    """
    1. Creates a new GCP project.
    2. Enables 'generativelanguage.googleapis.com' and 'apikeys.googleapis.com'.
    3. Creates a new API key and retrieves the key string.
    """
    print(f"\n🚀 [1/4] Creating Google Cloud Project: {project_id} ({project_name})...")
    code, _, err = run_cmd(["gcloud", "projects", "create", project_id, f"--name={project_name}"], check=False)
    if code != 0:
        print(f"⚠️ Failed to create project {project_id}: {err}")
        return None

    # Wait 2 seconds for project propagation
    time.sleep(2)

    print(f"⚡ [2/4] Enabling Gemini & API Keys services on {project_id}...")
    services = [
        "generativelanguage.googleapis.com",
        "apikeys.googleapis.com"
    ]
    for s in services:
        print(f"   - Enabling {s}...")
        code, _, err = run_cmd(["gcloud", "services", "enable", s, f"--project={project_id}"], check=False)
        if code != 0:
            print(f"⚠️ Warning enabling {s}: {err}")

    # Wait 2 seconds for service enablement
    time.sleep(2)

    print(f"🔑 [3/4] Generating API Key for {project_id}...")
    code, stdout, err = run_cmd([
        "gcloud", "services", "api-keys", "create",
        f"--project={project_id}",
        f"--display-name={key_display_name}",
        "--format=json"
    ], check=False)

    if code != 0:
        print(f"⚠️ Failed to create API key: {err}")
        return None

    # Parse key resource name
    key_name = None
    try:
        data = json.loads(stdout)
        # Handle async operation response or direct response
        key_name = data.get("response", {}).get("name") or data.get("name")
    except Exception:
        pass

    # If key resource name not directly in response, list keys
    if not key_name:
        time.sleep(3)
        code, list_out, _ = run_cmd([
            "gcloud", "services", "api-keys", "list",
            f"--project={project_id}",
            "--format=json"
        ], check=False)
        if code == 0 and list_out:
            try:
                keys_data = json.loads(list_out)
                if keys_data and len(keys_data) > 0:
                    key_name = keys_data[0].get("name")
            except Exception:
                pass

    if not key_name:
        print(f"⚠️ Could not locate created key resource name for {project_id}")
        return None

    print(f"📥 [4/4] Fetching Key String for {key_name}...")
    # Fetch key string
    code, key_out, err = run_cmd([
        "gcloud", "services", "api-keys", "get-key-string",
        key_name,
        f"--project={project_id}",
        "--format=value(keyString)"
    ], check=False)

    if code == 0 and key_out.strip():
        api_key = key_out.strip()
        print(f"✅ Key Created: {api_key[:8]}...{api_key[-4:]}")
        
        # Step 5: Live verification with Google Gemini API endpoint
        print(f"🌐 Verifying key live with Google Gemini servers...")
        if verify_key_with_gemini(api_key):
            print(f"🎉 Verified! This is a REAL, ACTIVE Google Gemini API key.")
        else:
            print(f"ℹ️ Key created on GCP. Note: It may take ~30-60 seconds to propagate across all Google edge servers.")
        
        return api_key
    else:
        print(f"⚠️ Failed to retrieve key string: {err}")
        return None


def verify_key_with_gemini(api_key: str) -> bool:
    """Verifies that the key works live with Google Gemini / Generative Language API."""
    import urllib.request
    import urllib.error
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Gemini-Key-Verifier"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                return True
    except urllib.error.HTTPError as e:
        # If 403 or 400, might still be propagating or service not enabled yet
        return False
    except Exception:
        return False
    return False


def main():
    parser = argparse.ArgumentParser(
        description="Automate real Google Cloud Project creation and Gemini API key generation.",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "-n", "--count",
        type=int,
        default=3,
        help="Number of separate projects and keys to create (default: 3)"
    )
    parser.add_argument(
        "--prefix",
        type=str,
        default="pdf-ocr",
        help="Prefix for project IDs (default: 'pdf-ocr')"
    )
    parser.add_argument(
        "-o", "--output",
        type=str,
        default="backend/.env",
        help="Target file to write GEMINI_API_KEY into (default: 'backend/.env')"
    )

    args = parser.parse_args()

    # Step 1: Check gcloud installation
    if not check_gcloud_installed():
        print("❌ 'gcloud' CLI is not installed on your system.")
        print("\nPlease run the following command to install it:")
        print("   brew install --cask google-cloud-sdk")
        print("\nAfter installation completes, run:")
        print("   gcloud auth login")
        print("   python3 auto_create_gemini_keys.py -n 3")
        sys.exit(1)

    # Step 2: Check gcloud login
    active_account = check_gcloud_auth()
    if not active_account:
        print("⚠️ You are not currently logged in to gcloud.")
        print("Starting login browser flow now...")
        run_cmd(["gcloud", "auth", "login"], check=False)
        active_account = check_gcloud_auth()
        if not active_account:
            print("❌ Authentication failed or cancelled. Please run 'gcloud auth login' and try again.")
            sys.exit(1)

    print(f"👤 Logged in as: {active_account}")
    print(f"🎯 Target: Creating {args.count} separate projects and API keys for max independent quota.\n")

    successful_keys: List[str] = []

    for i in range(1, args.count + 1):
        proj_id = generate_random_project_id(prefix=args.prefix)
        proj_name = f"Gemini OCR Project {i}"
        key = create_project_and_get_key(proj_id, proj_name)
        if key:
            successful_keys.append(key)

    if not successful_keys:
        print("\n❌ No API keys could be created. Check GCP quotas or permissions.")
        sys.exit(1)

    print(f"\n=======================================================")
    print(f"🎉 Successfully created {len(successful_keys)} valid API Key(s) across separate projects!")
    print(f"=======================================================")
    for idx, k in enumerate(successful_keys, 1):
        print(f"  Key #{idx}: {k}")

    # Write to backend/.env
    env_content = f"GEMINI_API_KEY={','.join(successful_keys)}\n"
    target_path = os.path.abspath(args.output)
    
    try:
        existing = ""
        if os.path.exists(target_path):
            with open(target_path, "r", encoding="utf-8") as f:
                existing = f.read()
        
        # Replace or append GEMINI_API_KEY
        lines = [line for line in existing.splitlines() if not line.startswith("GEMINI_API_KEY=")]
        lines.append(f"GEMINI_API_KEY={','.join(successful_keys)}")
        
        with open(target_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(f"\n💾 Saved all keys to {target_path}")
    except Exception as e:
        print(f"⚠️ Could not write directly to {target_path}: {e}")

    print("\n🚀 Ready! Your backend will automatically rotate through all these keys.")


if __name__ == "__main__":
    main()
