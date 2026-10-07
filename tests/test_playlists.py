from datetime import datetime, timezone

from fyt import llm, playlists, posts, youtube
from fyt.config import Config
from fyt.store import Topics, Uploads


class FakeChannel:
    """Playlists and videos held in memory, counting every write."""

    def __init__(self, videos, lists):
        self.videos = videos
        self.lists = {name: {"id": f"PL{i}", "description": desc} for i, (name, desc) in enumerate(lists.items())}
        self.items = {pl["id"]: {} for pl in self.lists.values()}
        self.writes = []

    def install(self, monkeypatch):
        monkeypatch.setattr(youtube, "can_manage", lambda: True)
        monkeypatch.setattr(youtube, "recent_uploads", lambda limit=100: self.videos)
        monkeypatch.setattr(youtube, "playlists", lambda: dict(self.lists))
        monkeypatch.setattr(youtube, "playlist_items", lambda pid: dict(self.items[pid]))
        monkeypatch.setattr(youtube, "create_playlist", self.create)
        monkeypatch.setattr(youtube, "describe_playlist", lambda pid, name, d: self.writes.append(("describe", name)))
        monkeypatch.setattr(youtube, "add_playlist_item", self.add)
        monkeypatch.setattr(youtube, "remove_playlist_item", self.remove)

    def create(self, name, description="", privacy="public"):
        pid = f"PL{len(self.lists)}"
        self.lists[name] = {"id": pid, "description": description}
        self.items[pid] = {}
        self.writes.append(("create", name))
        return pid

    def add(self, pid, vid, top=True):
        self.items[pid][vid] = f"item-{vid}-{pid}"
        self.writes.append(("add", pid, vid))

    def remove(self, item_id):
        for items in self.items.values():
            for vid, iid in list(items.items()):
                if iid == item_id:
                    del items[vid]
        self.writes.append(("remove", item_id))

    def titles_in(self, name):
        return list(self.items[self.lists[name]["id"]])


def video(vid, seconds, title="T", description=""):
    return {"id": vid, "seconds": seconds, "title": title, "description": description, "publish_at": None}


def test_videos_go_to_the_playlist_for_their_series_and_format(monkeypatch, tmp_path):
    cfg = Config(jobs_dir=str(tmp_path))
    cfg.growth.series = ["Weird History", "Strange Science"]
    ch = FakeChannel(
        [video("short1", 45), video("long1", 480, description="x\n\nSeries: Weird History"), video("short2", 50)],
        {"Weird History": "old"},
    )
    ch.items["PL0"]["short1"] = "old-item"  # a Short filed with the long videos before the split
    ch.install(monkeypatch)
    monkeypatch.setattr(
        llm, "structured", lambda cfg, sys, user, schema, max_tokens=0: schema(videos=[{"number": 1, "series": "Strange Science"}])
    )
    assert playlists.organise(cfg, max_writes=20) > 0
    assert ch.titles_in("Weird History Shorts") == ["short1"]  # moved out of the long playlist
    assert ch.titles_in("Weird History") == ["long1"]
    assert ch.titles_in("Strange Science Shorts") == ["short2"]
    assert Uploads(cfg).note("series:short2") == "Strange Science"  # never asked again
    # A second run has nothing left to do.
    ch.writes.clear()
    assert playlists.organise(cfg, max_writes=20) == 0


def test_organise_stops_at_its_write_budget(monkeypatch, tmp_path):
    cfg = Config(jobs_dir=str(tmp_path))
    cfg.growth.series = ["Weird History"]
    cfg.growth.news_series = ""
    ch = FakeChannel([video(f"v{i}", 40, description="Series: Weird History") for i in range(10)], {})
    ch.install(monkeypatch)
    assert playlists.organise(cfg, max_writes=4) == 4  # create + 3 adds
    assert len(ch.titles_in("Weird History Shorts")) == 3


def test_new_uploads_are_filed_by_format(monkeypatch):
    calls = []
    monkeypatch.setattr(youtube, "add_to_playlist", lambda vid, name, about: calls.append((vid, name)))
    playlists.file_upload(Config(format="short"), "abc", "Bizarre Places")
    playlists.file_upload(Config(format="long"), "def", "Bizarre Places")
    assert calls == [("abc", "Bizarre Places Shorts"), ("def", "Bizarre Places")]


def test_community_post_drafts_are_weekly(monkeypatch, tmp_path):
    cfg = Config(jobs_dir=str(tmp_path))
    now = datetime(2026, 10, 7, 13, tzinfo=timezone.utc)
    Topics(cfg).add(["wiki:Tunguska event", "wiki:Dancing plague of 1518"])
    monkeypatch.setattr(youtube, "can_manage", lambda: True)
    monkeypatch.setattr(
        youtube,
        "recent_uploads",
        lambda limit=30: [
            {"id": "L1", "seconds": 500, "title": "The Long One", "description": "d", "publish_at": "2026-10-10T16:20:00Z"},
            {"id": "S1", "seconds": 40, "title": "A Short", "description": "d", "publish_at": "2026-10-06T14:10:00Z"},
        ],
    )
    seen = []

    def structured(cfg, system, user, schema, max_tokens=0):
        seen.append(user)
        return schema(poll={"question": "Next story?", "options": ["Sky blast", "Dance fever"]}, teaser="Watch it.", fact="Fact?")

    monkeypatch.setattr(llm, "structured", structured)
    out = tmp_path / "posts.md"
    assert posts.write_drafts(cfg, now, str(out))
    text = out.read_text()
    assert "Create post" in text and "   - Sky blast" in text and "https://youtu.be/L1" in text
    assert "Tunguska event" in seen[0] and "The Long One" in seen[0]
    assert not posts.write_drafts(cfg, now, str(out))  # done for this week
    assert posts.write_drafts(cfg, now, str(out), force=True)


def test_thumbnail_art_is_drawn_once_per_picture(monkeypatch, tmp_path):
    from PIL import Image

    from fyt import artgen

    prompts = []
    monkeypatch.setattr(artgen, "generate", lambda prompt, vertical=False, seed=7: prompts.append(prompt) or Image.new("RGB", (8, 8)))
    a = artgen.thumbnail_art("a wave of molasses in a street.", tmp_path)
    b = artgen.thumbnail_art("a wave of molasses in a street.", tmp_path)
    assert a == b and (tmp_path / a).exists() and len(prompts) == 1
    assert "street.." not in prompts[0] and "no text" in prompts[0]
