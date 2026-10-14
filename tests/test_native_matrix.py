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
        self.root = {'sourceCommit': 'a' * 40, 'sha256': 'b' * 64, 'version': '0.1.5'}
        self.native = {'sourceCommit': 'a' * 40, 'sha256': 'c' * 64,
                       'nativeSha256': 'd' * 64, 'version': '0.1.5'}
        self.report = {
            'passed': True, 'typesPassed': True, 'target': self.row['id'], 'platform': 'linux', 'arch': 'arm64',
            'nodeCell': '20.17.0', 'node': '20.17.0', 'napi': '8', 'glibc': '2.34',
            'sourceCommit': self.root['sourceCommit'], 'rootSha256': self.root['sha256'],
            'nativeArchiveSha256': self.native['sha256'], 'nativeSha256': self.native['nativeSha256'],
            'sdkVersion': '0.1.5', 'coreVersion': '1.1.14', 'frames': 1, 'samples': 480,
            'sourceIdentity': True, 'outputCancellation': True, 'stopSuccess': True,
            'relayWebsocketAvailable': True,
            'aec': {'processedFramesTotal': 400, 'discardedOutputFramesTotal': 0,
                    'echoPowerRatio': 0.01, 'voicePowerRatio': 0.9,
                    'rawStemUnchanged': True, 'observationsRetained': True, 'terminalState': 'stopped',
                    'tailFrames': 4, 'tailPaddingSamplesTotal': 1920},
            'exports': ['pocketstation', *[f'pocketstation/{n}' for n in ['node', 'browser', 'control', 'demo', 'voice']]],
        }

    def test_complete_component_report_passes(self):
        self.report['aec'] = {'available': False, 'unavailableErrorVerified': True}
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
                           ('stopSuccess', False), ('relayWebsocketAvailable', False), ('coreVersion', '1.1.11'), ('exports', [])]:
            with self.subTest(key=key):
                report = copy.deepcopy(self.report)
                report[key] = value
                with self.assertRaises(AssertionError):
                    module.validate_consumer(report, self.row, '20.17.0', self.root, self.native)

    def test_matrix_exactly_matches_native_manifests(self):
        directories = {path.name for path in (module.ROOT / 'npm').iterdir() if path.is_dir()}
        self.assertEqual(directories, {row['id'] for row in module.MATRIX['targets']})
        self.assertEqual(len(module.MATRIX['targets']) * len(module.MATRIX['nodes']), 30)

    def test_given_missing_echo_observations_when_validating_then_report_is_rejected(self):
        for key, value in [('processedFramesTotal', 0), ('processedFramesTotal', True),
                           ('discardedOutputFramesTotal', 1), ('discardedOutputFramesTotal', False),
                           ('rawStemUnchanged', False), ('observationsRetained', False),
                           ('terminalState', 'processing'), ('tailFrames', 0), ('tailFrames', True),
                           ('tailPaddingSamplesTotal', 0), ('tailPaddingSamplesTotal', True)]:
            with self.subTest(key=key, mutation='false'):
                report = copy.deepcopy(self.report)
                report['aec'][key] = value
                with self.assertRaises(AssertionError):
                    module.validate_aec(report['aec'])
            with self.subTest(key=key, mutation='missing'):
                report = copy.deepcopy(self.report)
                del report['aec'][key]
                with self.assertRaises(KeyError):
                    module.validate_aec(report['aec'])

    def test_given_pass_through_muted_or_nonfinite_signal_when_validating_then_rejected(self):
        for key, values in [
            ('echoPowerRatio', [1.0, 0.5, -1, float('nan'), float('inf'), False, None]),
            ('voicePowerRatio', [0.0, 0.5, 2.0, float('nan'), float('inf'), True, None]),
        ]:
            for value in values:
                with self.subTest(key=key, value=value):
                    report = copy.deepcopy(self.report)
                    report['aec'][key] = value
                    with self.assertRaises(AssertionError):
                        module.validate_aec(report['aec'])
            report = copy.deepcopy(self.report)
            del report['aec'][key]
            with self.assertRaises(KeyError):
                module.validate_aec(report['aec'])

    def test_lean_build_requires_unavailable_error_and_rejects_engine_claim(self):
        evidence = {'available': False, 'unavailableErrorVerified': True}
        module.validate_aec(evidence, expected_available=False)
        for key, value in [('available', True), ('available', 0),
                           ('unavailableErrorVerified', False), ('unavailableErrorVerified', 1)]:
            with self.subTest(key=key, value=value), self.assertRaises(AssertionError):
                module.validate_aec(dict(evidence, **{key: value}), expected_available=False)
        with self.assertRaises(AssertionError):
            module.validate_aec(self.report['aec'], expected_available=False)
        with self.assertRaises(KeyError):
            module.validate_aec(evidence, expected_available=True)

    def test_given_no_aec_report_when_validating_then_rejected(self):
        del self.report['aec']
        with self.assertRaises(KeyError):
            module.validate_consumer(self.report, self.row, '20.17.0', self.root, self.native)


class DiagnosticOverlayTests(unittest.TestCase):
    """Synthetic archives and owned child fixtures; never Windows addon proof."""
    def test_raw_zip_digest_refused_before_parsing_or_output(self):
        import tempfile
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / 'not-a-zip'
            path.write_bytes(b'synthetic data, not a qualified archive')
            destination = Path(work) / 'unpacked'
            with self.assertRaisesRegex(AssertionError, 'raw ZIP digest'):
                module.diagnostic_unzip(path, '0' * 64, destination, 'root')
            self.assertFalse(destination.exists())

    def test_zip_alias_traversal_directory_link_and_extra_members_refused(self):
        import hashlib
        import tempfile
        import zipfile
        for scenario in ['traversal', 'drive', 'backslash', 'case-alias', 'directory', 'symlink', 'extra']:
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as work:
                path = Path(work) / 'input.zip'
                with zipfile.ZipFile(path, 'w') as handle:
                    handle.writestr('root.json', '{}')
                    if scenario == 'extra':
                        handle.writestr('extra.json', '{}')
                    name = {'traversal': '../source.tgz', 'drive': 'C:source.tgz',
                        'backslash': 'sub\\source.tgz', 'case-alias': 'ROOT.JSON',
                        'directory': 'sub/', 'symlink': 'source.tgz', 'extra': 'source.tgz'}[scenario]
                    member = zipfile.ZipInfo(name)
                    if scenario == 'symlink':
                        member.create_system = 3
                        member.external_attr = (0o120777 << 16)
                    handle.writestr(member, b'not a package')
                actual = hashlib.sha256(path.read_bytes()).hexdigest()
                with self.assertRaises(AssertionError):
                    module.diagnostic_unzip(path, actual, Path(work) / 'unpacked', 'root')
                self.assertFalse((Path(work) / 'source.tgz').exists())

    @unittest.skipUnless(__import__('os').name == 'nt', 'Windows Job Object ownership only')
    def test_timeout_closes_parent_and_inherited_descendant_without_pass(self):
        import json
        import os
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as work:
            cell = Path(work) / 'cell'
            code = ('import subprocess,sys,time; '
                'child=subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"]); '
                'print(child.pid,flush=True); time.sleep(30)')
            raw, _, receipt = module.diagnostic_windows_run(
                [sys.executable, '-c', code], Path(work), cell, 1, 4096, dict(os.environ))
            self.assertEqual(receipt['decision'], 'BLOCK')
            self.assertTrue(receipt['timed_out'])
            self.assertTrue(receipt['assigned_before_resume'])
            self.assertTrue(receipt['root_wait_signaled'])
            self.assertEqual(receipt['active_processes'], 0)
            self.assertGreaterEqual(receipt['total_processes'], 2)
            self.assertTrue(receipt['owned_tree_closed'])
            self.assertTrue(receipt['cleanup_termination_requested'])
            self.assertTrue(raw.read_text().strip().isdigit(), 'The descendant must actually have spawned')
            self.assertLess(receipt['duration_ms'], 6500)
            if os.environ.get('PKS_WINDOWS_OWNER_TEST_OUTPUT'):
                module.write(Path(os.environ['PKS_WINDOWS_OWNER_TEST_OUTPUT']) / 'timeout-closed.json', receipt)

    @unittest.skipUnless(__import__('os').name == 'nt', 'Windows Job Object ownership only')
    def test_nonzero_child_keeps_failure_and_truthful_closed_receipt(self):
        import os
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as work:
            _, _, receipt = module.diagnostic_windows_run([sys.executable, '-c', 'raise SystemExit(7)'],
                Path(work), Path(work) / 'cell', 2, 4096, dict(os.environ))
            self.assertEqual(receipt['decision'], 'BLOCK')
            self.assertEqual(receipt['exit_code'], 7)
            self.assertTrue(receipt['owned_tree_closed'])
            self.assertFalse(receipt['timed_out'])
            if os.environ.get('PKS_WINDOWS_OWNER_TEST_OUTPUT'):
                module.write(Path(os.environ['PKS_WINDOWS_OWNER_TEST_OUTPUT']) / 'nonzero-closed.json', receipt)


    @unittest.skipUnless(__import__('os').name == 'nt', 'Windows Job Object ownership only')
    def test_parent_handle_reset_failure_retains_created_suspended_child_and_closes_it(self):
        import os
        import sys
        import tempfile
        from unittest.mock import patch
        original_reset = os.set_handle_inheritable
        forced = False
        def fail_once(handle, inheritable):
            nonlocal forced
            if inheritable is False and not forced:
                forced = True
                raise OSError('Synthetic parent inherited-handle reset failure')
            return original_reset(handle, inheritable)
        with tempfile.TemporaryDirectory() as work:
            with patch.object(os, 'set_handle_inheritable', side_effect=fail_once):
                _, _, receipt = module.diagnostic_windows_run(
                    [sys.executable, '-c', 'import time; time.sleep(30)'],
                    Path(work), Path(work) / 'cell', 2, 4096, dict(os.environ))
            self.assertTrue(forced)
            self.assertTrue(receipt['child_created'])
            self.assertIs(type(receipt['pid']), int)
            self.assertGreater(receipt['pid'], 0)
            self.assertEqual(receipt['decision'], 'BLOCK')
            self.assertEqual(receipt['error'], 'OSError')
            self.assertFalse(receipt['assigned_before_resume'])
            self.assertTrue(receipt['cleanup_termination_requested'])
            self.assertTrue(receipt['root_wait_signaled'])
            self.assertEqual(receipt['active_processes'], 0)
            self.assertTrue(receipt['owned_tree_closed'])
            self.assertFalse(receipt['timed_out'])
            if os.environ.get('PKS_WINDOWS_OWNER_TEST_OUTPUT'):
                module.write(Path(os.environ['PKS_WINDOWS_OWNER_TEST_OUTPUT']) / 'reset-error-closed.json', receipt)

    @unittest.skipUnless(__import__('os').name == 'nt', 'Windows Job Object ownership only')
    def test_zero_exit_requires_positive_owned_tree_closure_and_preserves_output(self):
        import os
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as work:
            raw, _, receipt = module.diagnostic_windows_run(
                [sys.executable, '-c', 'print("public-owned-zero-exit", flush=True)'],
                Path(work), Path(work) / 'cell', 2, 4096, dict(os.environ))
            self.assertEqual(receipt['decision'], 'PASS')
            self.assertEqual(receipt['exit_code'], 0)
            self.assertIsNone(receipt['error'])
            self.assertTrue(receipt['child_created'])
            self.assertTrue(receipt['assigned_before_resume'])
            self.assertTrue(receipt['root_wait_signaled'])
            self.assertEqual(receipt['active_processes'], 0)
            self.assertEqual(receipt['total_processes'], 1)
            self.assertTrue(receipt['owned_tree_closed'])
            self.assertFalse(receipt['cleanup_termination_requested'])
            self.assertFalse(receipt['timed_out'])
            self.assertEqual(raw.read_text().strip(), 'public-owned-zero-exit')
            if os.environ.get('PKS_WINDOWS_OWNER_TEST_OUTPUT'):
                module.write(Path(os.environ['PKS_WINDOWS_OWNER_TEST_OUTPUT']) / 'zero-exit-closed.json', receipt)


if __name__ == '__main__':
    unittest.main()
