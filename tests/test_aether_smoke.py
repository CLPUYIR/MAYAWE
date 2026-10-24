#!/usr/bin/env python3
"""
MAYAwe V2 - Aether Smoke Tests
Tests gesture classification, heuristic plane estimation, and class instantiation.
"""

import sys
import os
import math
import numpy as np

# Add aether directory to sys.path
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(repo_root, "aether"))

from processor import (
    Point3D,
    classify_hand_gesture,
    HeuristicPlaneEstimator,
    RansacPlaneSolver,
    AetherProcessorV2
)


def make_hand(thumb_tip_pos, index_tip_y, middle_tip_y, ring_tip_y, pinky_tip_y):
    """
    Constructs a 21-joint landmark list for testing gesture classifier.
    In camera coordinates, Y points down. Pip joints are set to y=0.5.
    A finger is 'open' when tip.y < pip.y (i.e. tip.y < 0.5).
    """
    pts = [Point3D(0.5, 0.8, 0.0) for _ in range(21)]
    # Set PIP joints at y = 0.5
    pts[6].y = 0.5   # index PIP
    pts[10].y = 0.5  # middle PIP
    pts[14].y = 0.5  # ring PIP
    pts[18].y = 0.5  # pinky PIP

    pts[8].x = 0.4
    pts[8].y = index_tip_y
    pts[12].y = middle_tip_y
    pts[16].y = ring_tip_y
    pts[20].y = pinky_tip_y

    pts[4].x, pts[4].y = thumb_tip_pos
    return pts


def test_hand_gesture_classifier():
    print("[1/3] Testing classify_hand_gesture across 5 gesture classes...")

    # 1. OPEN_PALM (all fingers open: tip.y < 0.5, thumb separated)
    h_open = make_hand((0.2, 0.4), 0.3, 0.3, 0.3, 0.3)
    g_open, _ = classify_hand_gesture(h_open)
    assert g_open == "OPEN_PALM", f"Expected OPEN_PALM, got {g_open}"

    # 2. FIST (all fingers closed: tip.y > 0.5, thumb separated)
    h_fist = make_hand((0.2, 0.7), 0.7, 0.7, 0.7, 0.7)
    g_fist, _ = classify_hand_gesture(h_fist)
    assert g_fist == "FIST", f"Expected FIST, got {g_fist}"

    # 3. INDEX_POINT (index open < 0.5, others closed > 0.5, thumb separated)
    h_point = make_hand((0.2, 0.7), 0.3, 0.7, 0.7, 0.7)
    g_point, target = classify_hand_gesture(h_point)
    assert g_point == "INDEX_POINT", f"Expected INDEX_POINT, got {g_point}"
    assert target is not None, "Expected raycast target for INDEX_POINT"
    assert "x" in target and "y" in target and "z" in target

    # 4. PINCH (thumb tip close to index tip, pinch_dist < 0.075, others closed)
    h_pinch = make_hand((0.41, 0.4), 0.4, 0.7, 0.7, 0.7)
    g_pinch, _ = classify_hand_gesture(h_pinch)
    assert g_pinch == "PINCH", f"Expected PINCH, got {g_pinch}"

    # 5. NONE (empty, incomplete, or ambiguous landmark set)
    g_none_empty, _ = classify_hand_gesture([])
    assert g_none_empty == "NONE", f"Expected NONE for empty, got {g_none_empty}"

    h_none_ambiguous = make_hand((0.2, 0.7), 0.7, 0.3, 0.7, 0.7) # Only middle finger open
    g_none_ambig, _ = classify_hand_gesture(h_none_ambiguous)
    assert g_none_ambig == "NONE", f"Expected NONE for ambiguous, got {g_none_ambig}"

    print("  -> classify_hand_gesture passed for all 5 gestures.")


def test_plane_estimator():
    print("[2/3] Testing HeuristicPlaneEstimator process_depth_and_planes...")
    estimator = HeuristicPlaneEstimator()
    assert len(estimator.planes) == 4, f"Expected 4 default planes, got {len(estimator.planes)}"

    # Test blank image
    blank_img = np.zeros((480, 640, 3), dtype=np.uint8)
    p_blank = estimator.process_depth_and_planes(blank_img)
    assert isinstance(p_blank, list) and len(p_blank) == 4, "Blank image should return 4 planes"
    assert p_blank[0]["class"] == "FLOOR"

    # Test random noise image
    random_img = np.random.randint(0, 256, (480, 640, 3), dtype=np.uint8)
    p_rand = estimator.process_depth_and_planes(random_img)
    assert isinstance(p_rand, list) and len(p_rand) == 4, "Random image should return 4 planes"

    # Test None input
    p_none = estimator.process_depth_and_planes(None)
    assert isinstance(p_none, list) and len(p_none) == 4

    # Test backward-compatible alias
    alias_solver = RansacPlaneSolver()
    assert isinstance(alias_solver, HeuristicPlaneEstimator)

    print("  -> process_depth_and_planes passed on blank and random frames.")


def test_instantiation():
    print("[3/3] Testing AetherProcessorV2 class instantiation...")
    processor = AetherProcessorV2()
    assert processor.plane_solver is not None
    assert processor.hand_tracker is not None
    assert processor.directive_seq == 1
    assert processor.current_directive["state"] == "IDLE_SCAN"

    # Test directive adoption increments seq
    processor.adopt_directive(state="CLIMB_CHAIR", speech="Climbing chair!")
    assert processor.directive_seq == 2
    assert processor.current_directive["state"] == "CLIMB_CHAIR"
    assert processor.current_directive["speechHud"] == "Climbing chair!"

    # Adopting identical values should NOT bump sequence
    processor.adopt_directive(state="CLIMB_CHAIR", speech="Climbing chair!")
    assert processor.directive_seq == 2

    processor.close()
    print("  -> AetherProcessorV2 instantiation and directive adoption passed.")


if __name__ == "__main__":
    try:
        test_hand_gesture_classifier()
        test_plane_estimator()
        test_instantiation()
        print("\nAll Aether smoke tests PASSED successfully! [Exit 0]")
        sys.exit(0)
    except Exception as e:
        print(f"\nAether smoke test FAILED: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
