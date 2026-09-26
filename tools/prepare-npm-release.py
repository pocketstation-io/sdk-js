#!/usr/bin/env python3
"""Bind a CI release to a successful qualification run and the approved digest."""
import argparse
import importlib.util
import json
from pathlib import Path
import re
import tempfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('matrix', HERE / 'qualify-native-matrix.py')
matrix = importlib.util.module_from_spec(spec)
spec.loader.exec_module(matrix)


def validate_run(run, commit, repository):
    assert re.fullmatch('[a-f0-9]{40}', commit)
    assert run['repository']['full_name'] == repository
    assert run['head_sha'] == commit
    assert run['path'] == '.github/workflows/qualify-distribution.yml'
    assert run['status'] == 'completed' and run['conclusion'] == 'success'
    assert run['event'] in ['push', 'workflow_dispatch']


def prepare(directory, commit, expected_digest, run, repository):
    directory = Path(directory).resolve()
    validate_run(run, commit, repository)
    assert re.fullmatch('[a-f0-9]{64}', expected_digest)
    manifest_path = directory / 'release-manifest.json'
    assert matrix.digest(manifest_path) == expected_digest, 'Qualification manifest digest differs'
    original = json.loads(manifest_path.read_text())
    with tempfile.TemporaryDirectory(prefix='pks-verify-release-') as work:
        fresh = Path(work) / 'verified.json'
        matrix.verify(directory, commit, fresh)
        assert json.loads(fresh.read_text()) == original, 'Recomputed qualification differs'
    packages = []
    targets = [(r['id'], 'native', f"@pocketstation/native-{r['id']}") for r in matrix.MATRIX['targets']]
    targets.append(('root', 'root', 'pocketstation'))
    for folder, kind, expected_name in targets:
        report, path, files = matrix.verified_artifact(directory / folder, kind)
        manifest = json.loads(files['package.json'])
        assert manifest['name'] == expected_name
        assert report['version'] == original['root']['version']
        packages.append({'name': expected_name, 'version': report['version'], 'sha256': report['sha256'],
                         'archive': path.relative_to(directory).as_posix()})
    plan = {'schema': 1, 'sourceCommit': commit, 'manifestSha256': expected_digest,
            'version': original['root']['version'], 'qualificationRun': run['id'], 'packages': packages}
    matrix.write(directory / 'publish-plan.json', plan)
    return plan


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--repository', required=True)
    args = parser.parse_args()
    prepare(args.directory, args.source_commit, args.manifest_sha256,
            json.loads(Path(args.run).read_text()), args.repository)


if __name__ == '__main__':
    main()
