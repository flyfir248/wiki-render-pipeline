import json
import subprocess

from fyt.assetlib import settle_rebase


def _git(cwd, *args):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, check=True, capture_output=True, text=True)


def test_two_runs_saving_to_the_library_keep_both_runs_entries(tmp_path):
    repo = tmp_path / "lib"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    (repo / "_misses.json").write_text('{"a": 1}')
    (repo / "note.txt").write_text("base")
    _git(repo, "add", ".")
    _git(repo, "commit", "-qm", "base")
    _git(repo, "checkout", "-qb", "other")
    (repo / "_misses.json").write_text('{"a": 1, "b": 2}')
    (repo / "note.txt").write_text("other run")
    _git(repo, "commit", "-qam", "other run")
    _git(repo, "checkout", "-q", "main")
    (repo / "_misses.json").write_text('{"a": 1, "c": 3}')
    (repo / "note.txt").write_text("this run")
    _git(repo, "commit", "-qam", "this run")
    assert subprocess.run(["git", "rebase", "other"], cwd=repo, capture_output=True).returncode != 0
    settle_rebase(repo)
    _git(repo, "-c", "core.editor=true", "rebase", "--continue")
    assert json.loads((repo / "_misses.json").read_text()) == {"a": 1, "b": 2, "c": 3}
    assert (repo / "note.txt").read_text() == "this run"
