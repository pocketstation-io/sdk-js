#!/usr/bin/env python3
"""Freeze and execute native npm archives; never infer execution from a filename."""
import argparse
import hashlib
import json
import math
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
        shutil.copy2(ROOT / 'tools/aec-consumer.mjs', work / 'aec-consumer.mjs')
        result = json.loads(run(['node', 'consumer.mjs', identity, native['nativeSha256'], root['version'], '1.1.14'], work))
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
    assert result['relayWebsocketAvailable'] is True
    assert result['sdkVersion'] == root['version'] == native['version']
    assert result['coreVersion'] == '1.1.14'
    assert result['frames'] == 1 and result['samples'] == 480
    assert all(result[k] is True for k in ['sourceIdentity', 'outputCancellation', 'stopSuccess'])
    # The shipping matrix builds ordinary engine-free addons. Positive engine
    # measurements cannot stand in for proving this artifact omits the engine.
    validate_aec(result['aec'], expected_available=False)
    assert result['exports'] == ['pocketstation', *[f'pocketstation/{n}' for n in ['node', 'browser', 'control', 'demo', 'voice']]]
    if row['platform'] == 'linux':
        assert result['glibc'] == '2.34', 'The claimed libc floor must actually execute'


def validate_aec(aec, *, expected_available=True):
    assert isinstance(aec, dict)
    if not expected_available:
        assert set(aec) == {'available', 'unavailableErrorVerified'}
        assert aec['available'] is False and aec['unavailableErrorVerified'] is True
        return
    assert type(aec['processedFramesTotal']) is int and aec['processedFramesTotal'] == 400
    assert type(aec['discardedOutputFramesTotal']) is int and aec['discardedOutputFramesTotal'] == 0
    assert aec['rawStemUnchanged'] is True and aec['observationsRetained'] is True
    assert aec['terminalState'] == 'stopped'
    assert type(aec['tailFrames']) is int and aec['tailFrames'] == 4
    assert type(aec['tailPaddingSamplesTotal']) is int and aec['tailPaddingSamplesTotal'] == 1920
    for field, minimum, maximum in [('echoPowerRatio', 0, 0.5), ('voicePowerRatio', 0.5, 2)]:
        value = aec[field]
        assert type(value) in (int, float) and math.isfinite(value)
        if minimum == 0:
            assert minimum <= value < maximum
        else:
            assert minimum < value < maximum


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


DIAGNOSTIC_SOURCE = '9072f2c84e36f6521db92d97d94082632ce42cbd'
DIAGNOSTIC_NATIVE_SHA = '488dc078a3311d65ea930e40e4545636f56189354100879a62388b173586e408'
DIAGNOSTIC_CONSUMER_SHA = '5a9ae25f7f896d5432bd4b130a2256a6f3914f1bcaaedf3313b49b6dc57d67aa'
DIAGNOSTIC_ARTIFACTS = {
    'root': (11849151499, '3d99c9dda86258af6217b151116ccdfea4db242c2f1032de520118306525a639', 1048576),
    'win32-x64-msvc': (11850065902, '3eabee070b8e029c07545056f242843d046df2346788d9e2cff67c54b2135292', 6291456),
}


def diagnostic_unzip(path, expected_hash, destination, kind):
    """Raw immutable ZIP equality is mandatory before inspecting its members."""
    import zipfile
    from pathlib import PurePosixPath
    assert digest(path) == expected_hash, 'Diagnostic raw ZIP digest differs'
    destination = Path(destination)
    destination.mkdir(exist_ok=False)
    with zipfile.ZipFile(path) as handle:
        members = handle.infolist()
        names = [member.filename for member in members]
        assert len(members) == 2 and len(set(name.casefold() for name in names)) == 2
        assert all(not member.is_dir() and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]*', member.filename) and
                   PurePosixPath(member.filename).name == member.filename and
                   not PurePosixPath(member.filename).is_absolute() and
                   ((member.external_attr >> 16) & 0o170000) in (0, 0o100000)
                   for member in members), 'Diagnostic ZIP member is unsafe'
        assert sum(member.file_size for member in members) <= 67108864
        assert kind + '.json' in names and sum(name.endswith('.tgz') for name in names) == 1
        for member in members:
            (destination / member.filename).write_bytes(handle.read(member))
    return verified_artifact(destination, kind)


def diagnostic_windows_run(argv, cwd, folder, seconds, maximum_bytes, env):
    """One suspended Windows child is assigned before resume; no breakaway."""
    import _winapi
    import ctypes
    from ctypes import wintypes as w
    import msvcrt
    import time
    assert os.name == 'nt' and ctypes.sizeof(ctypes.c_void_p) == 8
    assert 0 < seconds <= 60 and 0 < maximum_bytes <= 8388608
    folder = Path(folder)
    folder.mkdir(exist_ok=False)
    began = time.monotonic()
    deadline = began + seconds
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    class Basic(ctypes.Structure):
        _fields_ = [('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64),
            ('flags', w.DWORD), ('min_working_set', ctypes.c_size_t),
            ('max_working_set', ctypes.c_size_t), ('active_limit', w.DWORD),
            ('affinity', ctypes.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]
    class Limits(ctypes.Structure):
        _fields_ = [('basic', Basic), ('io', ctypes.c_uint64 * 6),
            ('process_memory', ctypes.c_size_t), ('job_memory', ctypes.c_size_t),
            ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]
    class Accounting(ctypes.Structure):
        _fields_ = [('user', ctypes.c_int64), ('kernel', ctypes.c_int64),
            ('period_user', ctypes.c_int64), ('period_kernel', ctypes.c_int64),
            ('faults', w.DWORD), ('total', w.DWORD), ('active', w.DWORD), ('terminated', w.DWORD)]
    assert ctypes.sizeof(Limits) == 144 and ctypes.sizeof(Accounting) == 48
    signatures = {
        'CreateJobObjectW': ([ctypes.c_void_p, w.LPCWSTR], w.HANDLE),
        'SetInformationJobObject': ([w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD], w.BOOL),
        'AssignProcessToJobObject': ([w.HANDLE, w.HANDLE], w.BOOL),
        'TerminateJobObject': ([w.HANDLE, w.UINT], w.BOOL),
        'QueryInformationJobObject': ([w.HANDLE, ctypes.c_int, ctypes.c_void_p, w.DWORD, ctypes.c_void_p], w.BOOL),
        'ResumeThread': ([w.HANDLE], w.DWORD),
        'CloseHandle': ([w.HANDLE], w.BOOL),
    }
    for name, (arguments, returns) in signatures.items():
        function = getattr(kernel, name)
        function.argtypes, function.restype = arguments, returns
    def check(ok):
        if not ok:
            raise ctypes.WinError(ctypes.get_last_error())
    def accounting(job):
        result = Accounting()
        check(kernel.QueryInformationJobObject(job, 1, ctypes.byref(result), ctypes.sizeof(result), None))
        receipt['total_processes'] = result.total
        return result.active
    process = thread = job = None
    assigned = False
    failure = None
    receipt = {'argv': argv, 'pid': None, 'child_created': False, 'assigned_before_resume': False,
        'exit_code': None, 'root_wait_signaled': False, 'active_processes': None, 'total_processes': None,
        'owned_tree_closed': False, 'timed_out': False, 'log_limit_exceeded': False,
        'cleanup_termination_requested': False, 'decision': 'BLOCK'}
    stdout_path, stderr_path = folder / 'stdout.raw', folder / 'stderr.raw'
    try:
        job = kernel.CreateJobObjectW(None, None)
        check(job)
        limits = Limits()
        limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway flags.
        check(kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
        with open(os.devnull, 'rb') as stdin, stdout_path.open('xb') as stdout, stderr_path.open('xb') as stderr:
            handles = [msvcrt.get_osfhandle(stream.fileno()) for stream in (stdin, stdout, stderr)]
            info = subprocess.STARTUPINFO(dwFlags=subprocess.STARTF_USESTDHANDLES,
                hStdInput=handles[0], hStdOutput=handles[1], hStdError=handles[2],
                lpAttributeList={'handle_list': handles})
            for handle in handles:
                os.set_handle_inheritable(handle, True)
            try:
                process, thread, pid, _ = _winapi.CreateProcess(str(Path(argv[0]).resolve()),
                    subprocess.list2cmdline(argv), None, None, True, 0x4, env, str(cwd), info)
                receipt.update(pid=pid, child_created=True)
            finally:
                for handle in handles:
                    os.set_handle_inheritable(handle, False)
            check(kernel.AssignProcessToJobObject(job, process))
            assigned = True
            receipt['assigned_before_resume'] = True
            assert kernel.ResumeThread(thread) == 1, 'Suspended child resume failed'
            while True:
                assert time.monotonic() < deadline, 'Diagnostic child deadline'
                extent = stdout_path.stat().st_size + stderr_path.stat().st_size
                if extent > maximum_bytes:
                    receipt['log_limit_exceeded'] = True
                    raise RuntimeError('Diagnostic child output extent')
                if _winapi.WaitForSingleObject(process, 20) == _winapi.WAIT_OBJECT_0:
                    receipt['root_wait_signaled'] = True
                    receipt['exit_code'] = _winapi.GetExitCodeProcess(process)
                    break
            assert receipt['exit_code'] == 0, 'Diagnostic child nonzero'
    except BaseException as error:
        receipt['timed_out'] = time.monotonic() >= deadline
        failure = type(error).__name__
    finally:
        cleanup_deadline = time.monotonic() + 5
        try:
            if process is not None:
                if assigned:
                    if accounting(job) != 0:
                        if failure is None:
                            failure = 'LingeringDescendant'
                        receipt['cleanup_termination_requested'] = True
                        check(kernel.TerminateJobObject(job, 1))
                else:
                    receipt['cleanup_termination_requested'] = True
                    _winapi.TerminateProcess(process, 1)
                while time.monotonic() < cleanup_deadline:
                    receipt['root_wait_signaled'] = _winapi.WaitForSingleObject(process, 20) == _winapi.WAIT_OBJECT_0
                    receipt['active_processes'] = accounting(job)
                    if receipt['root_wait_signaled'] and receipt['active_processes'] == 0:
                        receipt['owned_tree_closed'] = True
                        if receipt['exit_code'] is None:
                            receipt['exit_code'] = _winapi.GetExitCodeProcess(process)
                        break
                if not receipt['owned_tree_closed']:
                    failure = failure or 'CleanupUncertain'
        except BaseException:
            failure = failure or 'CleanupUncertain'
        for handle in (thread, process, job):
            if handle is not None:
                if not kernel.CloseHandle(handle):
                    failure = failure or 'HandleCloseUncertain'
        remaining = maximum_bytes
        for label, path in [('stdout', stdout_path), ('stderr', stderr_path)]:
            if path.exists():
                extent = path.stat().st_size
                receipt[label + 'ObservedBytes'] = extent
                receipt[label + 'ObservedSha256'] = digest(path)
                if extent > remaining:
                    receipt['log_limit_exceeded'] = True
                    failure = failure or 'OutputExtentExceeded'
                    with path.open('r+b') as stream:
                        stream.truncate(remaining)
                remaining -= path.stat().st_size
                receipt[label + 'RetainedBytes'] = path.stat().st_size
                receipt[label + 'RetainedSha256'] = digest(path)
        receipt.update(error=failure, duration_ms=round((time.monotonic() - began) * 1000))
        if failure is None and receipt['owned_tree_closed']:
            receipt['decision'] = 'PASS'
        write(folder / 'receipt.json', receipt)
    return stdout_path, stderr_path, receipt


def diagnose_windows(harness_commit, output):
    """New diagnostic source runs old exact binary bytes; never distribution."""
    import time
    assert os.name == 'nt' and re.fullmatch('[0-9a-f]{40}', harness_commit)
    assert harness_commit != DIAGNOSTIC_SOURCE and os.environ.get('GITHUB_SHA') == harness_commit
    assert os.environ.get('GITHUB_REF') == 'refs/heads/diagnostic/wss-win32-node20-174'
    assert os.environ.get('GITHUB_REPOSITORY') == 'pocketstation-io/sdk-js'
    assert os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
    assert os.environ.get('GITHUB_RUN_ATTEMPT') == '1'
    assert digest(ROOT / 'tools/native-matrix-consumer.mjs') == DIAGNOSTIC_CONSUMER_SHA
    output = Path(output).resolve()
    output.mkdir(exist_ok=False)
    deadline = time.monotonic() + 180
    receipt = {'classification': 'PARTIAL', 'distributionQualified': False,
        'artifactSourceCommit': DIAGNOSTIC_SOURCE, 'harnessCommit': harness_commit,
        'consumerSha256': DIAGNOSTIC_CONSUMER_SHA, 'ownerSha256': digest(__file__),
        'aecConsumerSha256': digest(ROOT / 'tools/aec-consumer.mjs'), 'originalRunId': 38467173910,
        'cells': [], 'decision': 'BLOCK'}
    assert receipt['aecConsumerSha256'] == '2f64267055a9909a5f70dcd9d374ee333555b5d2775918189997a392e6f0e54e'
    def bounded_cell(label, argv, cwd, folder, seconds, extent, env):
        assert time.monotonic() < deadline, 'Diagnostic total deadline before child admission'
        raw, error, observed = diagnostic_windows_run(argv, cwd, folder,
            min(seconds, deadline-time.monotonic()), extent, env)
        preserved = output / 'cell-receipts' / (label + '.json')
        write(preserved, observed)
        receipt['cells'].append({'kind': label, 'processReceipt': str(preserved.relative_to(output)),
            'processReceiptSha256': digest(preserved), 'process': observed})
        assert observed['decision'] == 'PASS' and observed['owned_tree_closed'], 'Owned diagnostic cell failed'
        return raw, error
    failure = None
    try:
        with tempfile.TemporaryDirectory(prefix='pks-wss-diagnostic-') as temporary:
            work = Path(temporary)
            env = {**os.environ, 'GH_DEBUG': '', 'GH_PROMPT_DISABLED': '1', 'GIT_OPTIONAL_LOCKS': '0',
                'PYTHONDONTWRITEBYTECODE': '1'}
            artifacts = {}
            for name, (identity, expected_hash, extent) in DIAGNOSTIC_ARTIFACTS.items():
                assert time.monotonic() < deadline
                cell = work / ('download-' + name)
                gh = shutil.which('gh')
                assert gh and Path(gh).is_file()
                raw, _ = bounded_cell('download-' + name, [gh, 'api', '--hostname', 'github.com',
                    '--method', 'GET', f'repos/pocketstation-io/sdk-js/actions/artifacts/{identity}/zip'],
                    work, cell, 20, extent, env)
                artifacts[name] = diagnostic_unzip(raw, expected_hash, work / name, 'root' if name == 'root' else 'native')
                receipt['cells'][-1].update(artifactId=identity, ZIPdigest=expected_hash)
            root, root_path, root_files = artifacts['root']
            native, native_path, native_files = artifacts['win32-x64-msvc']
            assert root['sourceCommit'] == native['sourceCommit'] == DIAGNOSTIC_SOURCE
            assert root['version'] == native['version'] == '0.1.5' and native['target'] == 'win32-x64-msvc'
            assert native['nativeSha256'] == DIAGNOSTIC_NATIVE_SHA
            for key in ('GH_TOKEN', 'GITHUB_TOKEN'):
                env.pop(key, None)
            env.update(NODE_OPTIONS='', NODE_EXTRA_CA_CERTS='', NODE_TLS_REJECT_UNAUTHORIZED='1')
            write(work / 'package.json', {'private':True, 'type':'module'})
            node = shutil.which('node')
            selected_npm = shutil.which('npm')
            assert node and Path(node).is_file() and selected_npm
            npm_cli = Path(selected_npm).parent / 'node_modules/npm/bin/npm-cli.js'
            assert npm_cli.is_file()
            receipt['tools'] = {'nodeSha256': digest(node), 'ghSha256': digest(gh), 'npmCliSha256': digest(npm_cli)}
            version, _ = bounded_cell('node-identity', [node, '--version'], work, work/'node-identity', 2, 64, env)
            assert version.read_text().strip() == 'v20.20.2', 'Diagnostic Node version differs'
            bounded_cell('offline-install', [node, str(npm_cli), 'install', '--offline', '--ignore-scripts',
                '--omit=optional', '--no-audit', '--no-fund', str(root_path), str(native_path)],
                work, work/'install', 60, 1048576, env)
            for name, files in [('pocketstation',root_files),('@pocketstation/native-win32-x64-msvc',native_files)]:
                for relative, content in files.items():
                    assert time.monotonic() < deadline, 'Diagnostic total deadline during installed-byte verification'
                    assert (work/'node_modules'/name/relative).read_bytes() == content
            receipt.update(rootArchiveSha256=root['sha256'],nativeArchiveSha256=native['sha256'],
                nativeSha256=DIAGNOSTIC_NATIVE_SHA, installedBytesMatch=True, nodeVersion='20.20.2')
            shutil.copy2(ROOT/'tools/native-matrix-consumer.mjs',work/'consumer.mjs')
            shutil.copy2(ROOT/'tools/aec-consumer.mjs',work/'aec-consumer.mjs')
            raw, error = bounded_cell('native-diagnostic', [node,'consumer.mjs','win32-x64-msvc',
                DIAGNOSTIC_NATIVE_SHA,'0.1.5','1.1.14'],work,output/'installed-consumer',
                30,3145728,env)
            result = json.loads(raw.read_text())
            assert result['node'] == '20.20.2' and result['platform'] == 'win32' and result['arch'] == 'x64'
            assert time.monotonic() < deadline, 'Diagnostic total deadline after result'
            receipt['decision'] = 'PASS'
    except BaseException as error:
        failure = type(error).__name__
    finally:
        if failure is not None:
            receipt['decision'] = 'BLOCK'
        receipt.update(error=failure, scope='Same-host diagnostic only; no release manifest or consumer qualification report.')
        write(output/'diagnostic-terminal.json',receipt)
    assert failure is None, 'Windows diagnosis failed; retain diagnostic evidence'


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
    d = sub.add_parser('diagnose-windows')
    d.add_argument('--harness-commit', required=True)
    d.add_argument('--output', required=True)
    args = parser.parse_args()
    if args.command == 'matrix':
        rows = MATRIX['targets'] if args.kind == 'build' else [dict(row, node=node) for row in MATRIX['targets'] for node in MATRIX['nodes']]
        print(json.dumps({'include': rows}, separators=(',', ':')))
    elif args.command == 'freeze':
        freeze(args.kind, args.target, args.output)
    elif args.command == 'consume':
        consume(args.target, args.node, args.directory, args.output)
    elif args.command == 'diagnose-windows':
        diagnose_windows(args.harness_commit, args.output)
    else:
        verify(args.directory, args.source_commit, args.output)


if __name__ == '__main__':
    main()
