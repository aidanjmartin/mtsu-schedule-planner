"""Make the importer and build modules importable from the tests."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
for folder in (ROOT / "importer", ROOT / "tools"):
    sys.path.insert(0, str(folder))
