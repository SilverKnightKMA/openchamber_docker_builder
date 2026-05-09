#!/usr/bin/env sh
set -eu

manifest="${1:-tools/managed-tools.json}"

echo "[validate-managed-tools] Checking schema..."
if ! python3 -c "
import json, sys

with open('${manifest}', 'r') as f:
    m = json.load(f)

required = ['schemaVersion', 'policy', 'groups', 'sources']
for k in required:
    if k not in m:
        print(f'missing required key: {k}')
        sys.exit(1)

if m['schemaVersion'] != 1:
    print(f'unknown schema version: {m[\"schemaVersion\"]}')
    sys.exit(1)

policy = m['policy']
if not policy.get('requireUpstreamChecksum'):
    print('policy must require upstream checksums')
    sys.exit(1)
if policy.get('allowDownloadAndHash'):
    print('policy must not allow download-and-hash fallback')
    sys.exit(1)

rules = policy.get('compareRules', {})
expected = {'missing': 'install', 'equal': 'skip', 'lower': 'upgrade', 'higher': 'warn_skip', 'unparseable': 'warn_skip'}
for k, v in expected.items():
    if rules.get(k) != v:
        print(f'compareRules.{k} must be \"{v}\", got \"{rules.get(k)}\"')
        sys.exit(1)

groups = m['groups']
for g in ['npm', 'go', 'rustup', 'releaseBinaries']:
    if g not in groups:
        print(f'missing group: {g}')
        sys.exit(1)

print('schema OK')
"; then
    echo "[validate-managed-tools] FAIL: schema validation failed"
    exit 1
fi

echo "[validate-managed-tools] Checking npm group..."
if ! python3 -c "
import json, sys

pkg = json.load(open('tools/managed-npm-package.json'))
if 'dependencies' not in pkg:
    print('missing dependencies in package.json')
    sys.exit(1)
if not pkg['dependencies']:
    print('dependencies must not be empty')
    sys.exit(1)
print(f'npm: {len(pkg[\"dependencies\"])} packages OK')
"; then
    echo "[validate-managed-tools] FAIL: npm group validation failed"
    exit 1
fi

echo "[validate-managed-tools] Checking go toolchain..."
if ! python3 -c "
import json, sys

tc = json.load(open('tools/managed-go-toolchain.json'))
for f in ['version', 'checksum', 'url', 'installPath']:
    if f not in tc:
        print(f'missing {f} in go-toolchain manifest')
        sys.exit(1)
import hashlib, urllib.request
print(f'go toolchain: {tc[\"version\"]} OK')
"; then
    echo "[validate-managed-tools] FAIL: go toolchain validation failed"
    exit 1
fi

echo "[validate-managed-tools] Checking go.mod..."
if command -v go >/dev/null 2>&1; then
    if ! python3 -c "
import subprocess, sys
result = subprocess.run(['go', 'list', '-tags=tools', '-e', '-json', 'tools/managed-go'], capture_output=True, text=True)
if result.returncode != 0:
    print('go.mod validation failed: go list failed')
    print(result.stderr)
    sys.exit(1)
print('go.mod OK')
"; then
        echo "[validate-managed-tools] FAIL: go.mod validation failed"
        exit 1
    fi
else
    echo "[validate-managed-tools] SKIP: go not available in env; checking go.mod structure only..."
    if ! python3 -c "
import sys
lines = open('tools/managed-go/go.mod').readlines()
if not any(l.startswith('go ') for l in lines):
    print('go directive missing in go.mod')
    sys.exit(1)
if not any(l.startswith('module ') for l in lines):
    print('module directive missing in go.mod')
    sys.exit(1)
print('go.mod structure OK (go not present to verify deps)')
"; then
        echo "[validate-managed-tools] FAIL: go.mod structure check failed"
        exit 1
    fi
fi

echo "[validate-managed-tools] Checking rustup manifest..."
if ! python3 -c "
import json, sys
r = json.load(open('tools/managed-rustup.json'))
required = ['toolchain', 'version', 'targets', 'profile']
for k in required:
    if k not in r:
        print(f'missing {k} in rustup manifest')
        sys.exit(1)
print('rustup manifest OK')
"; then
    echo "[validate-managed-tools] FAIL: rustup manifest validation failed"
    exit 1
fi

echo "[validate-managed-tools] Checking release binaries manifest..."
if ! python3 -c "
import json, sys

rb = json.load(open('tools/managed-release-binaries.json'))
pol = rb.get('policy', {})
if not pol.get('requireUpstreamChecksum'):
    print('release-binaries policy must require upstream checksums')
    sys.exit(1)
if pol.get('allowDownloadAndHash'):
    print('release-binaries policy must not allow download-and-hash')
    sys.exit(1)

for t in rb.get('tools', []):
    for f in ['name', 'repo', 'version', 'asset', 'sha256']:
        if f not in t:
            print(f'missing {f} in tool entry')
            sys.exit(1)
    if len(t['sha256']) != 64 or not all(c in '0123456789abcdefABCDEF' for c in t['sha256']):
        print(f'invalid sha256 for {t[\"name\"]}')
        sys.exit(1)
print(f'release binaries: {len(rb[\"tools\"])} tools OK')
"; then
    echo "[validate-managed-tools] FAIL: release binaries manifest validation failed"
    exit 1
fi

echo "[validate-managed-tools] All validations passed"