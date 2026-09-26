"""Reject untrusted or failed CI runs before reading their release artifacts."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('release', Path(__file__).resolve().parents[1] / 'tools/prepare-npm-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class QualificationRunTests(unittest.TestCase):
    def test_failed_wrong_source_or_foreign_runs_are_rejected(self):
        commit = 'a' * 40
        valid = {'repository': {'full_name': 'pocketstation-io/sdk-js'}, 'head_sha': commit,
                 'path': '.github/workflows/qualify-distribution.yml', 'status': 'completed',
                 'conclusion': 'success', 'event': 'push'}
        release.validate_run(valid, commit, 'pocketstation-io/sdk-js')
        for field, value in [('head_sha', 'b' * 40), ('path', '.github/workflows/other.yml'),
                             ('status', 'in_progress'), ('conclusion', 'failure'),
                             ('event', 'pull_request'), ('repository', {'full_name': 'other/sdk-js'})]:
            with self.subTest(field=field):
                changed = copy.deepcopy(valid)
                changed[field] = value
                with self.assertRaises(AssertionError):
                    release.validate_run(changed, commit, 'pocketstation-io/sdk-js')


if __name__ == '__main__':
    unittest.main()
