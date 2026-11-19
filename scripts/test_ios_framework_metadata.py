"""Regression cases for Apple's required framework minimum-OS metadata."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('metadata', Path(__file__).with_name('check-ios-framework-metadata.py'))
metadata = importlib.util.module_from_spec(spec)
if spec.loader:
    spec.loader.exec_module(metadata)


class FrameworkMetadataTests(unittest.TestCase):
    def test_reads_actual_ios_binary_minimum(self):
        self.assertEqual(metadata.binary_minimum(' platform IOS\n    minos 15.1\n sdk 26.2\n'), '15.1')

    def test_rejects_non_ios_and_ambiguous_binaries(self):
        for text in ['platform MACOS\nminos 15.1', 'platform IOS\nminos 15.1\nplatform IOS\nminos 16.0', 'platform IOS\nminos 0.0']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                metadata.binary_minimum(text)

    def test_missing_minimum_is_reported_without_explicit_repair(self):
        with self.assertRaisesRegex(ValueError, 'MinimumOSVersion'):
            metadata.checked_metadata({'CFBundleExecutable': 'hermesvm'}, '15.1', repair=False)

    def test_repair_uses_verified_binary_version_without_changing_input(self):
        original = {'CFBundleExecutable': 'hermesvm'}
        fixed = metadata.checked_metadata(original, '15.1', repair=True)
        self.assertEqual(fixed, {**original, 'MinimumOSVersion': '15.1'})
        self.assertNotIn('MinimumOSVersion', original)

    def test_matching_is_unchanged_and_conflicting_version_is_never_overwritten(self):
        original = {'MinimumOSVersion': '15.1'}
        self.assertEqual(metadata.checked_metadata(original, '15.1', repair=False), original)
        with self.assertRaisesRegex(ValueError, 'differs'):
            metadata.checked_metadata({'MinimumOSVersion': '16.0'}, '15.1', repair=True)


if __name__ == '__main__':
    unittest.main()
