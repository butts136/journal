#!/usr/bin/env python3
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path


def main() -> int:
    app_dir = Path(__file__).resolve().parent
    node_binary = shutil.which("node")
    npm_binary = shutil.which("npm")

    if not node_binary:
        sys.stderr.write("Node.js est requis mais introuvable dans le PATH.\n")
        return 1

    if not npm_binary:
        sys.stderr.write("npm est requis mais introuvable dans le PATH.\n")
        return 1

    if not (app_dir / "node_modules").exists():
        install_result = subprocess.run(
            [npm_binary, "install"],
            cwd=str(app_dir),
            env=os.environ.copy(),
        )

        if install_result.returncode != 0:
            return install_result.returncode

    env = os.environ.copy()
    env.setdefault("PORT", "39014")

    process = subprocess.Popen(
        [node_binary, "server.js"],
        cwd=str(app_dir),
        env=env,
    )

    def forward_signal(signum, _frame):
        if process.poll() is None:
            process.send_signal(signum)

    signal.signal(signal.SIGINT, forward_signal)
    signal.signal(signal.SIGTERM, forward_signal)

    try:
        return process.wait()
    except KeyboardInterrupt:
        forward_signal(signal.SIGINT, None)
        return process.wait()


if __name__ == "__main__":
    raise SystemExit(main())
