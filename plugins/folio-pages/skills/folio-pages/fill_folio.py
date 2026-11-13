#!/usr/bin/env python3
"""Put a JSON document into a Folio Pages file, safely.

    python3 fill_folio.py FILE.html DOC.json            # fill an empty (blank) file
    python3 fill_folio.py FILE.html DOC.json --replace  # replace an existing document
    python3 fill_folio.py FILE.html --check             # check the document block

Only the <script type="application/folio+json" id="folio-doc"> block changes.
Every "<" in the JSON is written as \\u003c. Standard library only.
"""
import json
import re
import sys

OPEN = re.compile(r'<script\b[^>]*\bid="folio-doc"[^>]*>', re.I)


def locate(html):
    """Return (start, end) of the block content, skipping mentions inside comments."""
    for m in OPEN.finditer(html):
        before = html[: m.start()]
        if before.rfind("<!--") > before.rfind("-->"):
            continue  # inside an HTML comment
        end = html.find("</script>", m.end())
        if end < 0:
            break
        return m.end(), end
    raise SystemExit("error: no folio-doc block found. Is this a Folio Pages file?")


def is_encrypted(text):
    """A password-protected document: its block holds only the encrypted envelope."""
    try:
        return json.loads(text).get("format") == "folio/enc"
    except (json.JSONDecodeError, AttributeError):
        return False


def check_doc(doc):
    problems = []
    if not isinstance(doc, dict):
        return ["the document must be a JSON object"]
    if doc.get("format") != "folio/doc":
        problems.append('"format" should be "folio/doc"')
    if doc.get("version") != 1:
        problems.append('"version" should be 1')
    if "blocks" not in doc and "markdown" not in doc:
        problems.append('give "blocks" (or "markdown")')
    meta = doc.get("meta") or {}
    if not meta.get("title"):
        problems.append("meta.title is not set")
    if not meta.get("lang"):
        problems.append("meta.lang is not set")
    return problems


def main(argv):
    if len(argv) < 3 or argv[1].startswith("-"):
        print(__doc__)
        return 2
    path = argv[1]
    with open(path, encoding="utf-8") as f:
        html = f.read()
    start, end = locate(html)
    current = html[start:end].strip()

    if argv[2] == "--check":
        if not current:
            print("blank app: the folio-doc block is empty")
            return 1
        if is_encrypted(current):
            print("password-protected document: it cannot be read without the password")
            return 1
        try:
            doc = json.loads(current)
        except json.JSONDecodeError as e:
            print(f"error: the JSON does not parse: {e}")
            return 1
        problems = check_doc(doc)
        for p in problems:
            print("warning:", p)
        print("ok" if not problems else f"{len(problems)} warning(s)")
        return 0

    with open(argv[2], encoding="utf-8") as f:
        doc = json.load(f)  # fails loudly on invalid JSON
    if current and is_encrypted(current):
        raise SystemExit("error: this document is protected by a password; it cannot be read or replaced here")
    if current and "--replace" not in argv:
        raise SystemExit("error: this file already holds a document; pass --replace to overwrite it")
    if current and "--replace" in argv:
        try:
            old_id = json.loads(current).get("id")
        except (json.JSONDecodeError, AttributeError):
            old_id = None
        if old_id:
            doc["id"] = old_id  # never change an existing document's identity
    for p in check_doc(doc):
        print("warning:", p)
    text = json.dumps(doc, ensure_ascii=False, indent=2).replace("<", "\\u003c")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html[:start] + "\n" + text + "\n" + html[end:])
    print(f"wrote {len(text)} characters into the folio-doc block of {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
