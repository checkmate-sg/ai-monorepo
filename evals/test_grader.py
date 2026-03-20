import unittest
from grader import get_assert 

class TestGraderScoring(unittest.TestCase):

    def test_perfect_match(self):
        # Expert: bad | Predicted: bad -> Expected Score: 1.0
        context = {"vars": {"expert_broad_category": "bad"}}
        result = get_assert("bad", context)
        
        self.assertTrue(result["pass"])
        self.assertEqual(result["score"], 1.0)

    def test_asymmetric_false_negative(self):
        # Expert: bad | Predicted: caution -> Expected Score: 0.2 (Dangerous)
        context = {"vars": {"expert_broad_category": "bad"}}
        result = get_assert("caution", context)
        
        # 0.2 is > 0, so it technically passes, but with a terrible score
        self.assertTrue(result["pass"]) 
        self.assertEqual(result["score"], 0.2)

    def test_asymmetric_false_positive(self):
        # Expert: caution | Predicted: bad -> Expected Score: 0.6 (Overly strict)
        context = {"vars": {"expert_broad_category": "caution"}}
        result = get_assert("bad", context)
        
        self.assertEqual(result["score"], 0.6)

    def test_unknown_prediction(self):
        # Expert: good | Predicted: hallucination -> Expected Score: 0.0
        context = {"vars": {"expert_broad_category": "good"}}
        result = get_assert("something_made_up", context)
        
        self.assertFalse(result["pass"])
        self.assertEqual(result["score"], 0.0)
        self.assertIn("Unknown prediction", result["reason"])

if __name__ == '__main__':
    unittest.main()