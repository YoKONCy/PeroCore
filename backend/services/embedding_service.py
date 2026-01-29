import json
import os
import asyncio
from typing import List, Optional
import numpy as np

# 为了避免在导入时就下载模型，我们使用延迟加载
# 并且设置本地缓存目录
data_dir = os.environ.get("PERO_DATA_DIR", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["SENTENCE_TRANSFORMERS_HOME"] = os.path.join(data_dir, "models_cache")
# 设置 HuggingFace 镜像，解决国内连接问题
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
# 同时设置 HF_HOME，确保 huggingface_hub也能找到缓存
os.environ["HF_HOME"] = os.environ["SENTENCE_TRANSFORMERS_HOME"]

# --- Suppress Logging & Progress Bars ---
# Disable tqdm progress bars globally (e.g. for model loading)
os.environ["TQDM_DISABLE"] = "1"
# Suppress transformers info/warning logs
os.environ["TRANSFORMERS_VERBOSITY"] = "error"
# ----------------------------------------

class EmbeddingService:
    _instance = None
    _model = None
    _cross_encoder = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(EmbeddingService, cls).__new__(cls)
        return cls._instance

    def _resolve_local_path(self, model_name: str) -> Optional[str]:
        """
        Manually resolve model path from cache to bypass huggingface_hub issues
        """
        try:
            # List of directories to search for the model
            search_dirs = []
            
            # 1. Custom configured path
            custom_cache = os.environ.get("SENTENCE_TRANSFORMERS_HOME")
            if custom_cache:
                search_dirs.append(custom_cache)
            
            # 2. Standard HuggingFace Hub cache
            hf_home = os.environ.get("HF_HOME")
            if hf_home and hf_home not in search_dirs:
                search_dirs.append(hf_home)
                
            default_hf_cache = os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub")
            if default_hf_cache not in search_dirs:
                search_dirs.append(default_hf_cache)

            # 3. Old SentenceTransformers cache
            default_st_cache = os.path.join(os.path.expanduser("~"), ".cache", "torch", "sentence_transformers")
            if default_st_cache not in search_dirs:
                search_dirs.append(default_st_cache)

            print(f"[Embedding] Debug: Searching for model '{model_name}' in dirs: {search_dirs}", flush=True)

            repo_id = "models--" + model_name.replace("/", "--")
            
            for cache_dir in search_dirs:
                if not os.path.exists(cache_dir):
                    continue

                # Check paths to look into (root and hub subdir)
                candidate_base_paths = [
                    os.path.join(cache_dir, repo_id),
                    os.path.join(cache_dir, "hub", repo_id)
                ]
                
                for base_path in candidate_base_paths:
                    # print(f"[Embedding] Debug: Checking base path: {base_path}", flush=True)
                    if not os.path.exists(base_path):
                        continue
                        
                    # 策略 1: 检查 snapshots 目录并找到最新的 snapshot
                    snapshots_dir = os.path.join(base_path, "snapshots")
                    if os.path.exists(snapshots_dir):
                        snapshots = os.listdir(snapshots_dir)
                        # print(f"[Embedding] Debug: Found snapshots in {base_path}: {snapshots}", flush=True)
                        if snapshots:
                            # 简单地取第一个找到的 snapshot
                            snapshot_path = os.path.join(snapshots_dir, snapshots[0])
                            # 验证 snapshot 是否包含 config.json
                            config_path = os.path.join(snapshot_path, "config.json")
                            if os.path.isdir(snapshot_path) and os.path.exists(config_path):
                                print(f"[Embedding] Debug: Found valid config at {config_path}", flush=True)
                                return snapshot_path
                            # else:
                                # print(f"[Embedding] Debug: Config not found at {config_path}", flush=True)

                    # 策略 2 (Legacy): 检查 refs/main
                    ref_path = os.path.join(base_path, "refs", "main")
                    if os.path.exists(ref_path):
                        try:
                            with open(ref_path, 'r') as f:
                                commit_hash = f.read().strip()
                            snapshot_path = os.path.join(base_path, "snapshots", commit_hash)
                            if os.path.exists(snapshot_path):
                                return snapshot_path
                        except:
                            pass
                        
        except Exception as e:
            print(f"[Embedding] Manual path resolution failed: {e}", flush=True)
        return None

    def _load_model(self):
        if self._model is None:
            print("[Embedding] 正在加载嵌入模型 (all-MiniLM-L6-v2)...", flush=True)
            from sentence_transformers import SentenceTransformer
            
            # Strategy: Try Manual Path Resolution First (Most Robust) -> Then Library Cache -> Then Online
            model_name = 'sentence-transformers/all-MiniLM-L6-v2'
            
            # 1. Try manual path resolution
            local_path = self._resolve_local_path(model_name)
            if local_path:
                try:
                    print(f"[Embedding] 发现本地缓存路径: {local_path}，尝试直接加载...", flush=True)
                    self._model = SentenceTransformer(local_path)
                    print("[Embedding] 已从本地缓存路径加载模型。", flush=True)
                    return
                except Exception as manual_e:
                    print(f"[Embedding] 手动路径加载失败: {manual_e}", flush=True)

            # 2. Try library local load (fallback)
            try:
                self._model = SentenceTransformer('all-MiniLM-L6-v2', local_files_only=True)
                print("[Embedding] 已从本地缓存加载模型。", flush=True)
                return
            except Exception as e:
                print(f"[Embedding] 本地缓存未命中 (all-MiniLM-L6-v2): {e}。准备下载...", flush=True)
                
            print("[Embedding] 正在从镜像下载...", flush=True)
            try:
                # 3. Download from mirror
                self._model = SentenceTransformer('all-MiniLM-L6-v2', local_files_only=False)
                print("[Embedding] 模型下载并加载完成。", flush=True)
            except Exception as net_e:
                print(f"[Embedding] 致命错误: 无法下载模型: {net_e}", flush=True)
                raise net_e

    def _load_reranker(self):
        if self._cross_encoder is None:
            print("[Embedding] 正在加载重排序模型 (BAAI/bge-reranker-v2-m3)...", flush=True)
            from sentence_transformers import CrossEncoder
            
            # Strategy: Try Manual Path Resolution First
            model_name = 'BAAI/bge-reranker-v2-m3'
            
            # 1. Try manual path resolution
            local_path = self._resolve_local_path(model_name)
            if local_path:
                try:
                    print(f"[Embedding] 发现本地缓存路径: {local_path}，尝试直接加载...", flush=True)
                    self._cross_encoder = CrossEncoder(local_path)
                    print("[Embedding] 已从本地缓存路径加载重排序模型。", flush=True)
                    return
                except Exception as manual_e:
                    print(f"[Embedding] 手动路径加载失败: {manual_e}", flush=True)

            # 2. Try library local load (fallback) with Strict Local Mode
            try:
                # Use model_kwargs instead of automodel_args (deprecated)
                # Ensure local_files_only=True is passed to the underlying transformer
                self._cross_encoder = CrossEncoder(
                    'BAAI/bge-reranker-v2-m3', 
                    automodel_args={"local_files_only": True}, # Keep for backward compatibility
                    # model_kwargs={"local_files_only": True} # Newer versions might use this?
                    # Actually CrossEncoder init signature:
                    # def __init__(self, model_name, ..., automodel_args=None, ...)
                    # It seems it doesn't accept model_kwargs in init directly in some versions?
                    # But the warning said: "The CrossEncoder `automodel_args` argument was renamed and is now deprecated, please use `model_kwargs` instead."
                    # So we should pass model_kwargs if possible. But to be safe, let's try to pass it if automodel_args is what we have.
                    # Wait, if I pass BOTH, it might be safer or might error.
                    # Let's trust the warning message.
                )
                # Re-reading the warning: "please use `model_kwargs` instead."
                # But does the constructor accept `model_kwargs`?
                # If I look at the source code of sentence-transformers, it likely captures **kwargs and passes them?
                # Or it has a specific argument.
                # Let's try passing both via kwargs if possible, or just follow the instruction.
                
                # Let's try constructing with the new argument name as a keyword argument
                self._cross_encoder = CrossEncoder(
                    'BAAI/bge-reranker-v2-m3',
                    trust_remote_code=True,
                    automodel_args={"local_files_only": True}, # Legacy
                    # model_kwargs={"local_files_only": True}  # Future-proof? 
                    # If I pass undefined kwarg it might crash.
                    # Let's stick to automodel_args for now but add local_files_only to the constructor if supported? 
                    # No, CrossEncoder doesn't support local_files_only directly.
                )
                # Wait, if I want to be 100% sure, I should check if I can modify the call.
                # The user saw the warning, so the library version is NEW.
                # If the library is new, it supports model_kwargs.
            except:
                pass

            try:
                # Let's try the "New Way" based on the warning
                print("[Embedding] 尝试使用 model_kwargs 加载...", flush=True)
                self._cross_encoder = CrossEncoder(
                    'BAAI/bge-reranker-v2-m3',
                    model_kwargs={"local_files_only": True}
                )
                print("[Embedding] 已从本地缓存加载重排序模型 (model_kwargs)。", flush=True)
                return
            except Exception as e:
                print(f"[Embedding] model_kwargs 加载失败: {e}", flush=True)
                
            try:
                # Fallback to "Old Way"
                print("[Embedding] 尝试使用 automodel_args 加载...", flush=True)
                self._cross_encoder = CrossEncoder(
                    'BAAI/bge-reranker-v2-m3', 
                    automodel_args={"local_files_only": True}
                )
                print("[Embedding] 已从本地缓存加载重排序模型 (automodel_args)。", flush=True)
                return
            except Exception as e:
                print(f"[Embedding] automodel_args 加载失败: {e}", flush=True)

            print(f"[Embedding] 本地缓存未命中 (BAAI/bge-reranker-v2-m3)。准备下载...", flush=True)
            
            try:
                # 3. Download from mirror
                self._cross_encoder = CrossEncoder('BAAI/bge-reranker-v2-m3', local_files_only=False)
                print("[Embedding] 重排序模型下载并加载完成。", flush=True)
            except Exception as net_e:
                print(f"[Embedding] 致命错误: 无法下载重排序模型: {net_e}", flush=True)
                raise net_e

    def warm_up(self):
        """
        预热模型，防止首次请求超时
        """
        print("[Embedding] 正在预热模型...", flush=True)
        
        # 1. Warm up Embedding Model
        try:
            self._load_model()
            # 进行一次简单的推理以确保 GPU/CPU 内存完全加载
            if self._model:
                self._model.encode(["warm up"])
        except Exception as e:
            print(f"[Embedding] 嵌入模型预热失败: {e}", flush=True)

        # 2. Warm up Reranker Model
        try:
            self._load_reranker()
            if self._cross_encoder:
                self._cross_encoder.predict([["warm up", "test"]])
        except Exception as e:
            print(f"[Embedding] 重排序模型预热失败: {e}", flush=True)

        print("[Embedding] 预热流程结束。", flush=True)

    def encode(self, texts: List[str]) -> List[List[float]]:
        """
        生成文本向量
        """
        try:
            self._load_model()
            if not texts or self._model is None:
                return []
            
            embeddings = self._model.encode(texts)
            # 转换为 list
            return embeddings.tolist()
        except Exception as e:
            print(f"[Embedding] Rerank 失败: {e}", flush=True)
            return []

    def encode_one(self, text: str) -> List[float]:
        """生成单条文本向量"""
        try:
            result = self.encode([text])
            return result[0] if result else []
        except Exception:
            return []

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
        try:
            self._load_reranker()
            if not docs or self._cross_encoder is None:
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
        except Exception as e:
            print(f"[Embedding] 重排序失败: {e}", flush=True)
            # 返回原始顺序的分数（降级）
            return [{"index": i, "score": 1.0, "doc": doc} for i, doc in enumerate(docs[:top_k] if top_k else docs)]

# 全局单例
embedding_service = EmbeddingService()
