
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

def calculate_sf_metrics(predicted_sf, ground_truth_sf):
    """
    predicted_sf: set of (title, sent_idx)
    ground_truth_sf: set of (title, sent_idx)
    """
    if not predicted_sf:
        return 0, 0, 0
    
    tp = len(predicted_sf.intersection(ground_truth_sf))
    fp = len(predicted_sf - ground_truth_sf)
    fn = len(ground_truth_sf - predicted_sf)
    
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
    em = 1.0 if tp == len(ground_truth_sf) and fp == 0 else 0.0
    
    return em, f1, precision

def update_metrics(metrics, prediction, answer, predicted_sf=None, ground_truth_sf=None):
    metrics['count'] += 1
    metrics['em'] += 1.0 if exact_match_score(prediction, answer) else 0.0
    metrics['f1'] += f1_score(prediction, answer)
    
    if predicted_sf is not None and ground_truth_sf is not None:
        sf_em, sf_f1, _ = calculate_sf_metrics(set(predicted_sf), set(ground_truth_sf))
        metrics['sf_em'] = metrics.get('sf_em', 0) + sf_em
        metrics['sf_f1'] = metrics.get('sf_f1', 0) + sf_f1

def get_final_metrics(metrics):
    count = metrics['count']
    if count == 0:
        return {'em': 0, 'f1': 0, 'sf_em': 0, 'sf_f1': 0, 'count': 0}
    return {
        'em': (metrics['em'] / count) * 100,
        'f1': (metrics['f1'] / count) * 100,
        'sf_em': (metrics.get('sf_em', 0) / count) * 100,
        'sf_f1': (metrics.get('sf_f1', 0) / count) * 100,
        'count': count
    }
