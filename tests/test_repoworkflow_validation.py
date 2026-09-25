import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "repoworkflow-validate.py"


def load_validator():
  spec = importlib.util.spec_from_file_location("repoworkflow_validate", VALIDATOR)
  module = importlib.util.module_from_spec(spec)
  assert spec.loader is not None
  spec.loader.exec_module(module)
  return module


class RepoWorkflowValidationTests(unittest.TestCase):
  def test_validation_wrapper_does_not_write_python_bytecode(self):
    validator = load_validator()
    with tempfile.TemporaryDirectory() as td:
      root = Path(td)
      (root / "probe.py").write_text("VALUE = 1\n", encoding="utf-8")
      validator.ROOT = root
      rc = validator.run([sys.executable, "-c", "import probe"])
      self.assertEqual(0, rc)
      self.assertFalse((root / "__pycache__").exists())


if __name__ == "__main__":
  unittest.main()
