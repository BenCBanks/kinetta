"""Main reconciliation is closed to the exact source and migration sequence."""
from pathlib import Path
import unittest
from unittest.mock import patch
import kit_main_rebase as proof


class MainRebase(unittest.TestCase):
    def test_source_and_migrations(self):
        self.assertIn('app/db.py', proof.verify(Path(__file__).resolve().parents[2]))

    def test_later_source_drift_refuses(self):
        real = proof.git
        def drift(root, *args):
            if args[:2] == ('diff', '--name-only') and args[2] == proof.SOURCE:
                return 'app/kit_tools.py\n'
            return real(root, *args)
        with patch.object(proof, 'git', drift), self.assertRaises(ValueError):
            proof.verify(Path(__file__).resolve().parents[2])


if __name__ == '__main__':
    unittest.main()
