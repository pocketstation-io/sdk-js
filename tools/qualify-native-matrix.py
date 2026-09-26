#!/usr/bin/env python3
"""Freeze and execute native npm archives; never infer execution from a filename."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
MATRIX = json.loads((ROOT / 'tools/native-matrix.json').read_text())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def run(args, cwd=ROOT):
    result = subprocess.run(args, cwd=cwd, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=180)
    if result.returncode:
        raise RuntimeError(f'Command failed ({result.returncode}): {args}\n{result.stdout}')
    return result.stdout


def npm(args, cwd=ROOT):
    executable = shutil.which('npm')
    if os.name == 'nt':
        cli = Path(executable).parent / 'node_modules/npm/bin/npm-cli.js'
        if not cli.is_file():
            raise RuntimeError('Cannot resolve npm CLI beside the selected Node executable')
        return run(['node', str(cli), *args], cwd)
    return run([executable, *args], cwd)


def write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + '\n')


def target(identity):
    return next(row for row in MATRIX['targets'] if row['id'] == identity)


def archive(path):
    with tarfile.open(path, 'r:gz') as handle:
        members = handle.getmembers()
        assert all(m.isfile() or m.isdir() for m in members), 'Unexpected archive link'
        names = [m.name for m in members if m.isfile()]
        assert len(names) == len(set(names)), 'Duplicate archive members'
        assert all(n.startswith('package/') and '..' not in n.split('/') for n in names)
        files = {m.name.removeprefix('package/'): handle.extractfile(m).read()
                 for m in members if m.isfile()}
    return files, json.loads(files['package.json'])


def freeze(kind, identity, output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    directory = ROOT if kind == 'root' else ROOT / 'npm' / identity
    packed = json.loads(npm(['pack', str(directory), '--json', '--ignore-scripts',
                             '--pack-destination', str(output)]))
    assert len(packed) == 1
    path = output / packed[0]['filename']
    files, manifest = archive(path)
    binaries = [name for name in files if name.endswith('.node')]
    if kind == 'root':
        assert manifest['name'] == 'pocketstation' and not binaries
        expected = {f"@pocketstation/native-{r['id']}": manifest['version'] for r in MATRIX['targets']}
        assert manifest['optionalDependencies'] == expected
    else:
        row = target(identity)
        assert manifest['name'] == f'@pocketstation/native-{identity}'
        assert binaries == [manifest['main']]
        assert manifest['os'] == [row['platform']] and manifest['cpu'] == [row['arch']]
        if row['platform'] == 'linux':
            assert manifest['libc'] == ['glibc']
        assert len(files[binaries[0]]) > 100000, 'Native addon is missing or implausibly small'
    report = {'schema': 1, 'kind': kind, 'target': identity,
              'sourceCommit': run(['git', 'rev-parse', 'HEAD']).strip(),
              'filename': path.name, 'sha256': digest(path), 'version': manifest['version'],
              'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
    if binaries:
        report['nativeSha256'] = report['files'][binaries[0]]
        binary = directory / binaries[0]
        if row['platform'] == 'linux':
            report['dynamicDependencies'] = run(['ldd', str(binary)])
            assert 'not found' not in report['dynamicDependencies']
        elif row['platform'] == 'darwin':
            report['dynamicDependencies'] = run(['otool', '-L', str(binary)])
        else:
            report['dynamicDependencies'] = 'Windows loader resolution is exercised by the installed consumer.'
    write(output / f'{kind}.json', report)


def verified_artifact(directory, kind):
    directory = Path(directory)
    report = json.loads((directory / f'{kind}.json').read_text())
    path = directory / report['filename']
    assert path.name == report['filename'] and digest(path) == report['sha256']
    files, manifest = archive(path)
    assert report['files'] == {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    assert manifest['version'] == report['version']
    return report, path, files


def consume(identity, node_cell, directory, output):
    row = target(identity)
    root, root_path, root_files = verified_artifact(Path(directory) / 'root', 'root')
    native, native_path, native_files = verified_artifact(Path(directory) / identity, 'native')
    assert root['sourceCommit'] == native['sourceCommit'] == run(['git', 'rev-parse', 'HEAD']).strip()
    assert root['version'] == native['version'] and native['target'] == identity
    assert node_cell in MATRIX['nodes']
    with tempfile.TemporaryDirectory(prefix='pks-native-consumer-') as work:
        work = Path(work)
        write(work / 'package.json', {'private': True, 'type': 'module'})
        npm(['install', '--offline', '--ignore-scripts', '--omit=optional', '--no-audit', '--no-fund',
             str(root_path.resolve()), str(native_path.resolve())], work)
        for name, files in [('pocketstation', root_files), (f'@pocketstation/native-{identity}', native_files)]:
            for relative, content in files.items():
                installed = work / 'node_modules' / name / relative
                assert installed.read_bytes() == content, f'Installed bytes differ: {name}/{relative}'
        tooling = Path(os.environ.get('PKS_MATRIX_TYPES_DIR', ROOT / 'node_modules'))
        for package in ['@types/node', 'undici-types']:
            shutil.copytree(tooling / package, work / 'node_modules' / package)
        for suffix, source in [('mts', "import { Session } from 'pocketstation/node';\nexport const session = new Session();\n"),
                               ('cts', "import api = require('pocketstation/node');\nexport const session = new api.Session();\n")]:
            (work / f'consumer.{suffix}').write_text(source)
        write(work / 'tsconfig.json', {'compilerOptions': {
            'module': 'NodeNext', 'moduleResolution': 'NodeNext', 'target': 'ES2022',
            'strict': True, 'noEmit': True, 'skipLibCheck': False},
            'files': ['consumer.mts', 'consumer.cts']})
        run(['node', str(tooling / 'typescript/bin/tsc'), '-p', 'tsconfig.json'], work)
        shutil.copy2(ROOT / 'tools/native-matrix-consumer.mjs', work / 'consumer.mjs')
        result = json.loads(run(['node', 'consumer.mjs', identity, native['nativeSha256'], root['version'], '1.1.12'], work))
    result.update({'schema': 1, 'typesPassed': True, 'nodeCell': node_cell, 'sourceCommit': root['sourceCommit'],
                   'rootSha256': root['sha256'], 'nativeArchiveSha256': native['sha256']})
    validate_consumer(result, row, node_cell, root, native)
    write(output, result)


def validate_consumer(result, row, node_cell, root, native):
    assert result['passed'] is True and result['target'] == row['id']
    assert result['platform'] == row['platform'] and result['arch'] == row['arch']
    assert result['typesPassed'] is True
    assert result['nodeCell'] == node_cell
    assert result['node'] == node_cell or ('.' not in node_cell and result['node'].split('.')[0] == node_cell)
    assert int(result['napi']) >= 8
    assert result['sourceCommit'] == root['sourceCommit'] == native['sourceCommit']
    assert result['rootSha256'] == root['sha256'] and result['nativeArchiveSha256'] == native['sha256']
    assert result['nativeSha256'] == native['nativeSha256']
    assert result['sdkVersion'] == root['version'] == native['version']
    assert result['coreVersion'] == '1.1.12'
    assert result['frames'] == 1 and result['samples'] == 480
    assert all(result[k] is True for k in ['sourceIdentity', 'outputCancellation', 'stopSuccess'])
    assert result['exports'] == ['pocketstation', *[f'pocketstation/{n}' for n in ['node', 'browser', 'control', 'demo', 'voice']]]
    if row['platform'] == 'linux':
        assert result['glibc'] == '2.34', 'The claimed libc floor must actually execute'


def verify(directory, commit, output):
    directory = Path(directory)
    assert re.fullmatch('[0-9a-f]{40}', commit)
    root, _, _ = verified_artifact(directory / 'root', 'root')
    assert root['sourceCommit'] == commit
    cells = []
    native_reports = []
    for row in MATRIX['targets']:
        native, _, _ = verified_artifact(directory / row['id'], 'native')
        assert native['target'] == row['id'] and native['sourceCommit'] == commit
        native_reports.append(native)
        for node_cell in MATRIX['nodes']:
            path = directory / f"consumer-{row['id']}-{node_cell}" / 'consumer.json'
            result = json.loads(path.read_text())
            validate_consumer(result, row, node_cell, root, native)
            cells.append({'target': row['id'], 'nodeCell': node_cell, 'reportSha256': digest(path)})
    write(output, {'schema': 1, 'passed': True, 'sourceCommit': commit,
                   'root': root, 'nativePackages': native_reports, 'consumers': cells,
                   'claim': 'Installed Node component execution only; no physical capture or network claim.'})


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    m = sub.add_parser('matrix')
    m.add_argument('--kind', choices=['build', 'consume'], required=True)
    f = sub.add_parser('freeze')
    f.add_argument('--kind', choices=['root', 'native'], required=True)
    f.add_argument('--target', default=None)
    f.add_argument('--output', required=True)
    c = sub.add_parser('consume')
    c.add_argument('--target', required=True)
    c.add_argument('--node', required=True)
    c.add_argument('--directory', required=True)
    c.add_argument('--output', required=True)
    v = sub.add_parser('verify')
    v.add_argument('--directory', required=True)
    v.add_argument('--source-commit', required=True)
    v.add_argument('--output', required=True)
    args = parser.parse_args()
    if args.command == 'matrix':
        rows = MATRIX['targets'] if args.kind == 'build' else [dict(row, node=node) for row in MATRIX['targets'] for node in MATRIX['nodes']]
        print(json.dumps({'include': rows}, separators=(',', ':')))
    elif args.command == 'freeze':
        freeze(args.kind, args.target, args.output)
    elif args.command == 'consume':
        consume(args.target, args.node, args.directory, args.output)
    else:
        verify(args.directory, args.source_commit, args.output)


if __name__ == '__main__':
    main()
