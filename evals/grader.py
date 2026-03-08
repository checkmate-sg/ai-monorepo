CATEGORY_SCORES = {
    "bad": 1,
    "caution": 1.5,
    "good": 3,
}


def get_score(output, context):
    """
    output        – the transformed value (output.broadCategory)
    context       – dict containing { vars, prompt, ... }
    """
    expert = context["vars"].get("expert_broad_category", "").strip().lower()
    predicted = (output or "").strip().lower()

    # Rule 1: binary comparison when expert is "nothing"
    if expert == "nothing":
        passed = predicted == expert
        return {
            "pass": passed,
            "score": 1.0 if passed else 0.0,
            "reason": f"Binary match (expert='nothing'): predicted='{predicted}'",
        }

    # Rules 2-5: score based on numerical distance
    if expert not in CATEGORY_SCORES:
        return {
            "pass": False,
            "score": 0.0,
            "reason": f"Unknown expert_broad_category: '{expert}'",
        }
    if predicted not in CATEGORY_SCORES:
        return {
            "pass": False,
            "score": 0.0,
            "reason": f"Unknown output.broadCategory: '{predicted}'",
        }

    expert_val    = CATEGORY_SCORES[expert]
    predicted_val = CATEGORY_SCORES[predicted]

    diff  = abs(predicted_val - expert_val)   # |x|
    score = max(0.0, -0.5 * diff + 1)         # y = -0.5x + 1, clamped to [0, 1]

    return {
        "pass": score > 0.0,
        "score": score,
        "reason": (
            f"expert='{expert}' ({expert_val}), "
            f"predicted='{predicted}' ({predicted_val}), "
            f"diff={diff}, score={score:.4f}"
        ),
    }
