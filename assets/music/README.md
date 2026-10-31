# Background music

Tracks here replace the synthesised music (`fyt/music.py`). Put each in a folder named for the mood it
suits, and a video picks one for its script's mood:

```
assets/music/somber/     death, disaster, war, tragedy
assets/music/tense/      danger, mystery, a race against time
assets/music/curious/    strange facts and discoveries
assets/music/uplifting/  achievement, rescue, hope
assets/music/playful/    light, funny stories
```

Loose files in this folder are used for any mood when a mood has no folder of its own. MP3, WAV, M4A
and OGG all work. Three to four tracks a mood is enough to stop videos sounding alike.

Only add music the channel may use in monetised videos: the YouTube Audio Library (Studio → Audio
Library, filter "Attribution not required"), or tracks released as CC0 / public domain. Check every
track's licence; a Content ID claim takes the video's revenue.

The finished video is mastered to -14 LUFS (`loudness_lufs` in the config), so tracks don't need to be
levelled first; the music already ducks under the narrator in the render.
