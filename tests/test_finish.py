"""The finishing work around the renderer: loudness mastering, music by mood, and the benchmark reel."""

import shutil
import subprocess
from pathlib import Path

import pytest

from fyt import bench, media, render
from fyt.config import Config

FFMPEG = shutil.which("ffmpeg")


def _clip(path: Path, volume: float) -> Path:
    subprocess.run([FFMPEG, "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=4", "-f", "lavfi",
                    "-i", f"sine=frequency=440:duration=4,volume={volume}", "-shortest", "-c:v", "libx264", "-c:a", "aac", str(path)], check=True)
    return path


@pytest.mark.skipif(not FFMPEG, reason="needs ffmpeg")
def test_master_brings_quiet_and_loud_clips_to_the_target(tmp_path):
    for name, vol in [("quiet", 0.02), ("loud", 0.9)]:
        clip = _clip(tmp_path / f"{name}.mp4", vol)
        assert render.master(clip, -14.0)
        lufs = bench.loudness(clip)["lufs"]
        assert lufs is not None and abs(lufs + 14.0) < 1.5, (name, lufs)


@pytest.mark.skipif(not FFMPEG, reason="needs ffmpeg")
def test_master_leaves_a_silent_video_alone(tmp_path):
    clip = tmp_path / "silent.mp4"
    subprocess.run([FFMPEG, "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=2", "-c:v", "libx264", str(clip)], check=True)
    before = clip.read_bytes()
    assert not render.master(clip, -14.0)
    assert clip.read_bytes() == before


def test_loudnorm_stats_reads_the_last_json_block():
    err = 'noise {"a": 1}\n[Parsed_loudnorm_0] \n{\n "input_i" : "-23.1",\n "input_tp" : "-4.0",\n "input_lra" : "2.0",\n' \
          ' "input_thresh" : "-33.2",\n "target_offset" : "0.1"\n}\n'
    assert render.loudnorm_stats(err)["input_i"] == "-23.1"
    assert render.loudnorm_stats("no stats") is None


def test_music_is_picked_for_the_mood(tmp_path):
    for mood in ("tense", "somber"):
        (tmp_path / "music" / mood).mkdir(parents=True)
        (tmp_path / "music" / mood / f"{mood}-1.mp3").write_bytes(b"x")
    cfg = Config(format="long")
    cfg.music_dir = str(tmp_path / "music")
    public = tmp_path / "public"
    public.mkdir()
    for mood in ("tense", "somber"):
        name = media.pick_music(cfg, public, 5, seed=1, mood=mood)
        assert name == "music.mp3"
        assert (public / name).read_bytes() == b"x"
    # a mood with no folder of its own still gets a track from the others
    assert media.pick_music(cfg, public, 5, seed=1, mood="playful") == "music.mp3"


def test_the_benchmark_reel_covers_six_fixed_scenes():
    names = [b.name for b in bench.benches()]
    assert names == ["gimli", "voyager", "ghost-army", "krakatoa", "london", "storm"]
    for b in bench.benches():
        assert b.scenes and all(secs > 0 for _, secs in b.scenes)
        stage = [s for s, _ in b.scenes if s.subject == "stage"]
        assert bool(stage) == (b.story is not None)  # a stage scene needs its cast and place


def test_benchmark_props_are_built_offline_and_exactly_as_long_as_the_scenes(tmp_path, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "")
    cfg = Config(format="long")
    for b in bench.benches():
        if b.name not in ("gimli", "ghost-army"):
            continue
        props = bench.props_for(cfg, b, tmp_path / b.name)
        total = sum(secs for _, secs in b.scenes)
        assert props["duration"] == pytest.approx(total)
        assert props["scenes"][-1]["end"] == pytest.approx(total)
        assert all(s["type"] in ("world", "map") for s in props["scenes"])
        if b.name == "ghost-army":
            assert props["scenes"][1]["world"], "the stage scene gets its story world"


def test_scores_sheet_has_every_criterion_for_every_scene():
    report = {"scenes": {"gimli": {"tests": "aircraft", "notes": [], "seconds_per_frame": 0.4, "loudness": {"lufs": -14.0},
                                   "motion": [], "frozen": []}}}
    text = bench.scores_sheet("abc123", report)
    assert all(c in text for c in bench.CRITERIA)
    assert "## gimli" in text
