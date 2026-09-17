"""Run isolated API regression tests; never mutates a deployed fitness dashboard."""
import subprocess
import sys

if __name__ == '__main__':
    raise SystemExit(subprocess.call([sys.executable, '-m', 'pytest', 'tests', '-q', *sys.argv[1:]]))
