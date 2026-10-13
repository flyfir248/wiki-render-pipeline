import numpy as np
from PIL import Image

from fyt import cutout


def test_has_subject_wants_one_clear_thing_in_front():
    m = np.zeros((100, 100), dtype=np.float32)
    m[30:80, 35:65] = 1  # a figure in the middle
    assert cutout.has_subject(m)
    assert not cutout.has_subject(np.ones((100, 100), dtype=np.float32))  # all foreground: scenery
    assert not cutout.has_subject(np.zeros((100, 100), dtype=np.float32))  # nothing found
    fuzzy = np.full((100, 100), 0.5, dtype=np.float32)
    assert not cutout.has_subject(fuzzy)  # the model wasn't sure of anything
    edge = np.zeros((100, 100), dtype=np.float32)
    edge[:, :60] = 1  # a slab running off three edges, like a hillside
    assert not cutout.has_subject(edge)


def test_print_and_sticker_keep_the_photo_size():
    img = Image.fromarray((np.random.default_rng(0).random((60, 90, 3)) * 255).astype(np.uint8))
    printed = cutout.print_style(img, "#0b1020", "#efe6d4")
    assert printed.size == img.size and printed.mode == "RGB"
    m = np.zeros((60, 90), dtype=np.float32)
    m[15:50, 30:60] = 1
    s = cutout.sticker(img, m, edge=4)
    a = np.asarray(s)[..., 3]
    assert s.size == img.size and s.mode == "RGBA"
    assert a[30, 45] == 255 and a[2, 2] == 0  # subject kept, background clear
    assert a[30, 27] > 0  # the white border reaches past the subject's edge
