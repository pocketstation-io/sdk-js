"""Adversarial report tests; synthetic values here are not platform evidence."""
import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('native_matrix', Path(__file__).resolve().parents[1] / 'tools/qualify-native-matrix.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConsumerVerificationTests(unittest.TestCase):
    def setUp(self):
        self.row = module.target('linux-arm64-gnu')
        self.root = {'sourceCommit': 'a' * 40, 'sha256': 'b' * 64, 'version': '0.1.4'}
        self.native = {'sourceCommit': 'a' * 40, 'sha256': 'c' * 64,
                       'nativeSha256': 'd' * 64, 'version': '0.1.4'}
        self.report = {
            'passed': True, 'typesPassed': True, 'target': self.row['id'], 'platform': 'linux', 'arch': 'arm64',
            'nodeCell': '20.17.0', 'node': '20.17.0', 'napi': '8', 'glibc': '2.34',
            'sourceCommit': self.root['sourceCommit'], 'rootSha256': self.root['sha256'],
            'nativeArchiveSha256': self.native['sha256'], 'nativeSha256': self.native['nativeSha256'],
            'sdkVersion': '0.1.4', 'coreVersion': '1.1.12', 'frames': 1, 'samples': 480,
            'sourceIdentity': True, 'outputCancellation': True, 'stopSuccess': True,
            'exports': ['pocketstation', *[f'pocketstation/{n}' for n in ['node', 'browser', 'control', 'demo', 'voice']]],
        }

    def test_complete_component_report_passes(self):
        module.validate_consumer(self.report, self.row, '20.17.0', self.root, self.native)

    def test_cross_compilation_cannot_substitute_for_target_execution(self):
        for key, value in [('platform', 'darwin'), ('arch', 'x64'), ('glibc', '2.39')]:
            with self.subTest(key=key):
                report = dict(self.report, **{key: value})
                with self.assertRaises(AssertionError):
                    module.validate_consumer(report, self.row, '20.17.0', self.root, self.native)

    def test_wrong_artifact_or_source_is_rejected(self):
        for key in ['sourceCommit', 'rootSha256', 'nativeArchiveSha256', 'nativeSha256']:
            with self.subTest(key=key):
                report = dict(self.report, **{key: 'e' * len(self.report[key])})
                with self.assertRaises(AssertionError):
                    module.validate_consumer(report, self.row, '20.17.0', self.root, self.native)

    def test_missing_runtime_observations_are_rejected(self):
        for key, value in [('passed', False), ('typesPassed', False), ('frames', 0), ('samples', 0), ('node', '24.0.0'),
                           ('napi', '7'), ('sourceIdentity', False), ('outputCancellation', False),
                           ('stopSuccess', False), ('coreVersion', '1.1.11'), ('exports', [])]:
            with self.subTest(key=key):
                report = copy.deepcopy(self.report)
                report[key] = value
                with self.assertRaises(AssertionError):
                    module.validate_consumer(report, self.row, '20.17.0', self.root, self.native)

    def test_matrix_exactly_matches_native_manifests(self):
        directories = {path.name for path in (module.ROOT / 'npm').iterdir() if path.is_dir()}
        self.assertEqual(directories, {row['id'] for row in module.MATRIX['targets']})
        self.assertEqual(len(module.MATRIX['targets']) * len(module.MATRIX['nodes']), 30)


if __name__ == '__main__':
    unittest.main()
