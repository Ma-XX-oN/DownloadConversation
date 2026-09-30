import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "repoworkflow-validate.py"
WORKFLOW_VERSION = ROOT / "scripts" / "workflow-version.py"


def load_module(name: str, path: Path):
  spec = importlib.util.spec_from_file_location(name, path)
  module = importlib.util.module_from_spec(spec)
  assert spec.loader is not None
  spec.loader.exec_module(module)
  return module


def load_validator():
  return load_module("repoworkflow_validate", VALIDATOR)


def load_workflow_version():
  return load_module("workflow_version", WORKFLOW_VERSION)


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

  def test_workflow_version_accepts_plain_stable_semver_on_main(self):
    provider = load_workflow_version()
    with tempfile.TemporaryDirectory() as td:
      header = Path(td) / "userscript-header.js"
      header.write_text(
        "// ==UserScript==\n"
        "// @version      1.6.0\n"
        "// ==/UserScript==\n",
        encoding="utf-8",
      )
      provider.HEADER = header
      provider.branch_name = lambda: "main"
      self.assertEqual(0, provider.main())

  def test_workflow_version_rejects_issue_version_on_main(self):
    provider = load_workflow_version()
    with tempfile.TemporaryDirectory() as td:
      header = Path(td) / "userscript-header.js"
      header.write_text(
        "// ==UserScript==\n"
        "// @version      1.6.0-issue.186.1\n"
        "// ==/UserScript==\n",
        encoding="utf-8",
      )
      provider.HEADER = header
      provider.branch_name = lambda: "main"
      self.assertEqual(1, provider.main())

  def test_workflow_version_accepts_development_version_on_issue_branch(self):
    provider = load_workflow_version()
    with tempfile.TemporaryDirectory() as td:
      header = Path(td) / "userscript-header.js"
      header.write_text(
        "// ==UserScript==\n"
        "// @version      1.6.0-issue.186.1\n"
        "// ==/UserScript==\n",
        encoding="utf-8",
      )
      provider.HEADER = header
      provider.branch_name = lambda: "issue-186-main-version-invariant"
      self.assertEqual(0, provider.main())


if __name__ == "__main__":
  unittest.main()
