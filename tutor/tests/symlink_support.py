"""Skip symlink tests where the OS refuses to create symlinks (e.g. Windows WinError 1314 without Developer Mode/admin)."""
import os
import tempfile
import unittest


def _can_symlink() -> bool:
    with tempfile.TemporaryDirectory() as tmp:
        target = os.path.join(tmp, 'target')
        with open(target, 'w', encoding='utf-8') as stream:
            stream.write('x')
        try:
            os.symlink(target, os.path.join(tmp, 'link'))
        except (OSError, NotImplementedError):
            return False
    return True


requires_symlink = unittest.skipUnless(_can_symlink(), 'symlink creation is not permitted on this system')
