
import re
import string
from collections import Counter

def normalize_answer(s):
    """Lowercases the text, and removes punctuation, articles and extra whitespace."""
    def remove_articles(text):
        return re.sub(r'\b(a|an|the)\b', ' ', text)

    def white_space_fix(text):
        return ' '.join(text.split())

    def remove_punc(text):
        exclude = set(string.punctuation)
        return ''.join(ch for ch in text if ch not in exclude)

    def lower(text):
        return text.lower()

    return white_space_fix(remove_articles(remove_punc(lower(s))))

def f1_score(prediction, ground_truth):
    prediction_tokens = normalize_answer(prediction).split()
    ground_truth_tokens = normalize_answer(ground_truth).split()
    common = Counter(prediction_tokens) & Counter(ground_truth_tokens)
    num_same = sum(common.values())
    if num_same == 0:
        return 0
    precision = 1.0 * num_same / len(prediction_tokens)
    recall = 1.0 * num_same / len(ground_truth_tokens)
    f1 = (2 * precision * recall) / (precision + recall)
    return f1

def exact_match_score(prediction, ground_truth):
    return (normalize_answer(prediction) == normalize_answer(ground_truth))

def update_metrics(metrics, prediction, ground_truth):
    metrics['em'] += exact_match_score(prediction, ground_truth)
    metrics['f1'] += f1_score(prediction, ground_truth)
    metrics['count'] += 1

def get_final_metrics(metrics):
    if metrics['count'] == 0:
        return {'em': 0, 'f1': 0}
    return {
        'em': metrics['em'] / metrics['count'] * 100,
        'f1': metrics['f1'] / metrics['count'] * 100
    }
