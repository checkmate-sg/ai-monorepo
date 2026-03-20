import csv
import os


def load_score_table():
    """
    Load the confusion matrix from score_matrix.csv.
    
    Expected format:
    - First row: headers (actual, good, caution, bad, nothing, satire)
    - Rows 2-6: actual categories with scores for each predicted category
    
    Returns:
        dict: {(actual, predicted): score} for all 25 category pairs
    """
    matrix_path = os.path.join(os.path.dirname(__file__), "score_matrix.csv")
    
    if not os.path.exists(matrix_path):
        raise FileNotFoundError(
            f"score_matrix.csv not found at {matrix_path}. "
            "Please ensure the confusion matrix file exists in the evals directory."
        )
    
    score_table = {}
    
    try:
        with open(matrix_path, "r") as f:
            reader = csv.DictReader(f)
            
            if not reader.fieldnames:
                raise ValueError("score_matrix.csv is empty or malformed")
            
            # Extract predicted categories from header (skip "actual" column)
            predicted_categories = [col for col in reader.fieldnames if col != "actual"]
            
            row_num = 2  # Start from row 2 (after header)
            for row in reader:
                actual_cat = row["actual"].strip().lower()
                
                if not actual_cat:
                    raise ValueError(f"Row {row_num}: missing actual category name")
                
                for predicted_cat in predicted_categories:
                    score_str = row[predicted_cat].strip()
                    try:
                        score = float(score_str)
                        if not (0.0 <= score <= 1.0):
                            raise ValueError(
                                f"Row {row_num}, col '{predicted_cat}': "
                                f"score {score} is out of range [0.0, 1.0]"
                            )
                    except ValueError as e:
                        if "out of range" in str(e):
                            raise
                        raise ValueError(
                            f"Row {row_num}, col '{predicted_cat}': "
                            f"invalid score value '{score_str}' (expected float)"
                        )
                    
                    score_table[(actual_cat, predicted_cat.lower())] = score
                
                row_num += 1
    
    except FileNotFoundError:
        raise
    except Exception as e:
        raise ValueError(f"Error parsing score_matrix.csv: {e}")
    
    # Validate we have all 25 entries (5x5 matrix)
    if len(score_table) != 25:
        raise ValueError(
            f"score_matrix.csv must contain exactly 25 entries (5x5 matrix). "
            f"Found {len(score_table)} entries."
        )
    
    return score_table


# Load the score table on module import
try:
    SCORE_TABLE = load_score_table()
except Exception as e:
    print(f"ERROR loading score matrix: {e}")
    raise


def get_assert(output, context):
    """
    Evaluate prediction using confusion matrix lookup.
    
    Args:
        output  – the predicted category (output.broadCategory)
        context – dict containing { vars, prompt, ... }
    
    Returns:
        dict with keys: pass (bool), score (0.0-1.0), reason (str)
    
    Uses a 5x5 confusion matrix to score predictions based on:
    - expert_broad_category: actual category from test case
    - predicted category: extracted from output
    """
    expert = context["vars"].get("expert_broad_category", "").strip().lower()
    predicted = (output or "").strip().lower()

    # Get valid categories from the confusion matrix
    valid_actual = sorted(set(k[0] for k in SCORE_TABLE.keys()))
    valid_predicted = sorted(set(k[1] for k in SCORE_TABLE.keys()))
    
    # Validate expert category exists
    if expert not in valid_actual:
        return {
            "pass": False,
            "score": 0.0,
            "reason": f"Unknown expert_broad_category: '{expert}'. Valid: {valid_actual}",
        }
    
    # Validate predicted category exists
    if predicted not in valid_predicted:
        return {
            "pass": False,
            "score": 0.0,
            "reason": f"Unknown output.broadCategory: '{predicted}'. Valid: {valid_predicted}",
        }
    
    # Look up score from confusion matrix
    score = SCORE_TABLE[(expert, predicted)]
    
    return {
        "pass": score > 0.0,
        "score": score,
        "reason": f"Confusion matrix lookup: expert='{expert}', predicted='{predicted}', score={score}",
    }