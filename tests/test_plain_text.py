from fyt.models import DialogueLine, ScriptScene, plain
from fyt.speech import speakable


def test_markdown_emphasis_is_not_read_out():
    assert plain("The ship was *never* found.") == "The ship was never found."
    assert plain("**Twenty** lifeboats, _far_ too few") == "Twenty lifeboats, far too few"
    assert plain("# The wreck\n- a list item") == "The wreck\na list item"
    assert plain("a `quoted` word, snake_case kept") == "a quoted word, snake_case kept"
    assert plain("5*3") == "5 times 3"


def test_a_script_scene_keeps_no_asterisks_and_the_voice_never_hears_one():
    scene = ScriptScene(narration="It was *exactly* the route.", type="statement", heading="**Titan**")
    assert scene.narration == "It was exactly the route." and scene.heading == "Titan"
    assert DialogueLine(speaker="Captain", text="*Iceberg* ahead!").text == "Iceberg ahead!"
    assert "*" not in speakable("A *fictional* liner") and "asterisk" not in speakable("A *fictional* liner")


def test_a_word_after_a_stat_is_spaced_from_its_number():
    assert ScriptScene(type="stat", narration="a", value=13, suffix="survivors").suffix == " survivors"
    assert ScriptScene(type="stat", narration="a", value=40, suffix="%").suffix == "%"
    assert ScriptScene(type="stat", narration="a", value=5, suffix="km").suffix == "km"
