import csv
import os

# 1. Global dictionary to hold our scoring rules
SCORING_MATRIX = {}

def load_scoring_matrix(filepath="scoring_rules.csv"):
    """Loads the CSV mapping into memory once."""
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Could not find the scoring file at {filepath}")
        
    with open(filepath, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            expert = row['expert'].strip().lower()
            predicted = row['predicted'].strip().lower()
            score = float(row['score'])
            
            if expert not in SCORING_MATRIX:
                SCORING_MATRIX[expert] = {}
            SCORING_MATRIX[expert][predicted] = score

# Load the matrix immediately when the module is imported
load_scoring_matrix()


def get_assert(output, context):
    """
    output        – the transformed value (output.broadCategory)
    context       – dict containing { vars, prompt, ... }
    """
    expert = context["vars"].get("expert_broad_category", "").strip().lower()
    predicted = (output or "").strip().lower()

    # Handle missing expert categories
    if expert not in SCORING_MATRIX:
        return {
            "pass": False,
            "score": 0.0,
            "reason": f"Unknown expert_broad_category: '{expert}'",
        }

    # Handle missing predicted categories (e.g., LLM hallucinates a category)
    if predicted not in SCORING_MATRIX[expert]:
        return {
            "pass": False,
            "score": 0.0,
            "reason": f"Unknown prediction: '{predicted}' for expert '{expert}'",
        }

    # Retrieve custom score from the matrix
    score = SCORING_MATRIX[expert][predicted]

    return {
        "pass": score > 0.0,
        "score": score,
        "reason": (
            f"expert='{expert}', predicted='{predicted}', "
            f"custom_score={score:.4f}"
        ),
    }