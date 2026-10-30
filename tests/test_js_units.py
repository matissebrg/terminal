"""Browser-side pure functions, run under node (skipped when node is absent)."""
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent / "js"


@pytest.mark.skipif(shutil.which("node") is None, reason="node non installé")
@pytest.mark.parametrize("script", sorted(p.name for p in HERE.glob("*.test.js")))
def test_js_unit(script):
    out = subprocess.run(["node", str(HERE / script)], capture_output=True, text=True, cwd=HERE)
    assert out.returncode == 0, out.stderr or out.stdout
