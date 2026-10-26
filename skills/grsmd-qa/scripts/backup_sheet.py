"""Copy a Q&A sheet to old/<stem>_yyyymmdd_hhmm.md beside the sheet.

Run before the session edits the sheet, after the session has written it,
and after the user has updated it (before the session reads it). Skips the
copy when the newest backup already has the same content. Warns when old/
is not gitignored, since the backups are working copies and must not be
published.

  python <skill>/scripts/backup_sheet.py <sheet.md>
"""
import datetime
import filecmp
import glob
import os
import shutil
import subprocess
import sys


def newest_backup(folder, stem, ext):
    paths = glob.glob(os.path.join(glob.escape(folder), glob.escape(stem) + '_*' + ext))
    return max(paths, key=os.path.getmtime) if paths else None


def main(argv):
    if len(argv) != 2:
        print(__doc__.strip())
        return 2
    sheet = argv[1]
    if not os.path.isfile(sheet):
        print('ERROR no such file: %s' % sheet)
        return 1
    folder = os.path.join(os.path.dirname(os.path.abspath(sheet)), 'old')
    os.makedirs(folder, exist_ok=True)
    stem, ext = os.path.splitext(os.path.basename(sheet))
    latest = newest_backup(folder, stem, ext)
    if latest and filecmp.cmp(sheet, latest, shallow=False):
        print('OK unchanged since the last backup: %s' % os.path.relpath(latest))
    else:
        now = datetime.datetime.now()
        target = os.path.join(folder, '%s_%s%s' % (stem, now.strftime('%Y%m%d_%H%M'), ext))
        if os.path.exists(target):
            # A different version in the same minute: keep both, add seconds.
            target = os.path.join(folder, '%s_%s%s' % (stem, now.strftime('%Y%m%d_%H%M%S'), ext))
        shutil.copy2(sheet, target)
        print('OK backup: %s' % os.path.relpath(target))
    try:
        # git check-ignore: 0 ignored, 1 not ignored, 128 not a repository.
        code = subprocess.run(['git', 'check-ignore', '-q', os.path.join(folder, 'x' + ext)],
                              cwd=folder, capture_output=True).returncode
        ignored = code != 1
    except OSError:
        ignored = True
    if not ignored:
        print('WARN %s is not gitignored -- add the folder to .gitignore' % os.path.relpath(folder))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
