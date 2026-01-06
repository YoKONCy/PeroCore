import json
import os
import asyncio
from typing import List, Optional
import numpy as np

# 为了避免在导入时就下载模型，我们使用延迟加载
# 并且设置本地缓存目录
os.environ["SENTENCE_TRANSFORMERS_HOME"] = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "models_cache")
# 设置 HuggingFace 镜像，解决国内连接问题
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

class EmbeddingService:
    _instance = None
    _model = None
    _cross_encoder = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(EmbeddingService, cls).__new__(cls)
        return cls._instance

    def _load_model(self):
        if self._model is None:
            print("[Embedding] Loading embedding model (all-MiniLM-L6-v2)...", flush=True)
            try:
                from sentence_transformers import SentenceTransformer
                
                # 检查本地是否有完整的模型文件
                # HuggingFace 的本地缓存目录结构比较复杂，通常位于 models_cache/models--sentence-transformers--all-MiniLM-L6-v2
                # 如果快照存在，我们尝试直接加载本地快照，或者依赖 sentence_transformers 的自动缓存机制
                
                # 1. 尝试使用 sentence_transformers 的自动加载（会利用我们设置的 SENTENCE_TRANSFORMERS_HOME）
                # 如果本地有缓存且完整，它应该不会联网。
                # 但如果之前下载中断导致文件损坏，它可能会尝试重新联网。
                
                self._model = SentenceTransformer('all-MiniLM-L6-v2', local_files_only=False) # 允许联网以修复不完整的缓存，但在 HF_ENDPOINT 设置下应连接镜像
                print("[Embedding] Model loaded.", flush=True)
            except Exception as e:
                print(f"[Embedding] Error loading model from cache/internet: {e}", flush=True)
                print("[Embedding] Attempting to load with local_files_only=True...", flush=True)
                try:
                    # 2. 如果联网失败（即使是镜像），强制尝试仅加载本地文件
                    self._model = SentenceTransformer('all-MiniLM-L6-v2', local_files_only=True)
                    print("[Embedding] Model loaded from local cache (offline mode).", flush=True)
                except Exception as local_e:
                    print(f"[Embedding] Fatal: Could not load model even from local cache: {local_e}", flush=True)
                    raise e

    def _load_reranker(self):
        if self._cross_encoder is None:
            print("[Embedding] Loading reranker model (BAAI/bge-reranker-v2-m3)...", flush=True)
            try:
                from sentence_transformers import CrossEncoder
                # 使用 BGE-Reranker-v2-M3
                self._cross_encoder = CrossEncoder('BAAI/bge-reranker-v2-m3')
                print("[Embedding] Reranker loaded.", flush=True)
            except Exception as e:
                print(f"[Embedding] Error loading reranker: {e}", flush=True)
                raise e

    def encode(self, texts: List[str]) -> List[List[float]]:
        """
        生成文本向量
        """
        self._load_model()
        if not texts:
            return []
        
        embeddings = self._model.encode(texts)
        # 转换为 list
        return embeddings.tolist()

    def encode_one(self, text: str) -> List[float]:
        """生成单条文本向量"""
        result = self.encode([text])
        return result[0] if result else []

    def compute_similarity(self, query_embedding: List[float], doc_embeddings: List[List[float]]) -> List[float]:
        """
        计算余弦相似度
        """
        if not doc_embeddings:
            return []

        # 使用 numpy 加速
        q = np.array(query_embedding)
        docs = np.array(doc_embeddings)
        
        # 归一化 (MiniLM 输出通常已经归一化，但为了保险)
        norm_q = np.linalg.norm(q)
        norm_docs = np.linalg.norm(docs, axis=1)
        
        if norm_q == 0:
            return [0.0] * len(doc_embeddings)
            
        # 防止除零
        norm_docs[norm_docs == 0] = 1e-9
        
        # Cosine Similarity: (A . B) / (|A| * |B|)
        dot_products = np.dot(docs, q)
        similarities = dot_products / (norm_docs * norm_q)
        
        return similarities.tolist()

    def rerank(self, query: str, docs: List[str], top_k: int = None) -> List[dict]:
        """
        使用 Cross-Encoder 对文档进行重排序
        返回: [{"index": original_index, "score": float, "doc": str}, ...]
        """
        self._load_reranker()
        if not docs:
            return []
            
        # [Performance] BGE-Reranker-v2-M3 性能开销较大
        # 限制输入文档数量，确保精排在 1 秒内完成
        max_rerank_docs = 15
        if len(docs) > max_rerank_docs:
            print(f"[Embedding] Truncating rerank input from {len(docs)} to {max_rerank_docs} for performance.")
            docs = docs[:max_rerank_docs]
            
        pairs = [[query, doc] for doc in docs]
        scores = self._cross_encoder.predict(pairs)
        
        results = []
        for i, score in enumerate(scores):
            results.append({
                "index": i,
                "score": float(score),
                "doc": docs[i]
            })
            
        # 按分数降序
        results.sort(key=lambda x: x["score"], reverse=True)
        
        if top_k:
            return results[:top_k]
        return results

# 全局单例
embedding_service = EmbeddingService()
