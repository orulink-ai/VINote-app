"""Validate embedded iOS framework minimum-OS metadata against Mach-O evidence."""
import argparse
from pathlib import Path
import plistlib
import re
import subprocess


def binary_minimum(output):
    platforms = re.findall(r'^\s*platform\s+(\S+)\s*$', output, re.MULTILINE)
    versions = re.findall(r'^\s*minos\s+(\d+(?:\.\d+){1,2})\s*$', output, re.MULTILINE)
    if platforms != ['IOS'] or len(versions) != 1 or int(versions[0].split('.')[0]) < 8:
        raise ValueError('Expected one iOS build command with a supported minimum OS')
    return versions[0]


def checked_metadata(info, minimum, *, repair):
    result = dict(info)
    existing = result.get('MinimumOSVersion')
    if existing and existing != minimum:
        raise ValueError('Framework MinimumOSVersion differs from its binary')
    if not existing:
        if not repair:
            raise ValueError('Framework is missing MinimumOSVersion')
        result['MinimumOSVersion'] = minimum
    return result


def check_archive(archive, repair_hermes=False):
    apps = list((archive / 'Products/Applications').glob('*.app'))
    if len(apps) != 1:
        raise ValueError('Expected exactly one archived application')
    count = 0
    for framework in (apps[0] / 'Frameworks').glob('*.framework'):
        plist = framework / 'Info.plist'
        info = plistlib.loads(plist.read_bytes())
        name = info['CFBundleExecutable']
        if not isinstance(name, str) or Path(name).name != name:
            raise ValueError('Invalid framework executable name')
        output = subprocess.run(['xcrun', 'vtool', '-show-build', str(framework / name)],
                                check=True, capture_output=True, text=True).stdout
        minimum = binary_minimum(output)
        fixed = checked_metadata(info, minimum, repair=(repair_hermes and framework.name == 'hermesvm.framework'))
        if fixed != info:
            # Only unsigned archives may be prepared; export signs the finished metadata.
            if (framework / '_CodeSignature').exists():
                raise ValueError('Refusing to modify an already signed framework')
            temporary = plist.with_suffix('.plist.tmp')
            with temporary.open('xb') as handle:
                handle.write(plistlib.dumps(fixed, fmt=plistlib.FMT_BINARY))
            temporary.replace(plist)
            print('Prepared Hermes MinimumOSVersion from verified binary: ' + minimum)
        count += 1
    print('Verified minimum-OS metadata for ' + str(count) + ' embedded frameworks')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('--repair-hermes-minimum-os', action='store_true',
                        help='Fill missing Hermes metadata in an unsigned archive from its actual Mach-O minimum OS')
    args = parser.parse_args()
    check_archive(args.archive, args.repair_hermes_minimum_os)
