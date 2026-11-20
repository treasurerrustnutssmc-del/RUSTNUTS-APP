"""Writes the App Store Connect key from the ASC_API_KEY_P8 secret to the path given, as a clean .p8.

Run by the Store build workflow. A key pasted into the GitHub secret box on Windows can arrive with
\r line endings, stray spaces or blank lines, all on one line, or without its BEGIN/END lines, and
eas-cli then fails with '"pkcs8" must be PKCS#8 formatted string'. This keeps only the base64 body
and rewraps it the way Apple's file has it. It never prints the secret, only what was wrong.
"""

import os
import re
import sys


def fail(message: str) -> None:
    print(f"::error::{message}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: write-asc-key.py <output path>")
    pasted = os.environ.get("ASC_API_KEY_P8", "")
    if not pasted.strip():
        fail("The ASC_API_KEY_P8 repository secret is missing")
    if re.search(r"BEGIN (EC |RSA )?PRIVATE KEY", pasted) and "BEGIN PRIVATE KEY" not in pasted:
        fail("ASC_API_KEY_P8 holds a different kind of key; paste the App Store Connect .p8 file's text")
    body = re.sub(r"-----(BEGIN|END) PRIVATE KEY-----", "", pasted)
    body = re.sub(r"\s+", "", body)
    if not body or not re.fullmatch(r"[A-Za-z0-9+/]+={0,2}", body) or len(body) % 4:
        fail(
            "ASC_API_KEY_P8 isn't the text of a .p8 key file. Open AuthKey_GZ4F28YT8V.p8 in Notepad, "
            "copy all of it (-----BEGIN PRIVATE KEY----- to -----END PRIVATE KEY-----) and save the secret again"
        )
    lines = [body[i : i + 64] for i in range(0, len(body), 64)]
    out = sys.argv[1]
    with open(out, "w", newline="\n") as f:
        f.write("-----BEGIN PRIVATE KEY-----\n" + "\n".join(lines) + "\n-----END PRIVATE KEY-----\n")
    os.chmod(out, 0o600)


if __name__ == "__main__":
    main()
