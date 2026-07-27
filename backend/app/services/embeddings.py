import logging
from typing import List
from sentence_transformers import SentenceTransformer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Free lightweight model from Hugging Face: produces 384-dimensional vectors
MODEL_NAME = "all-MiniLM-L6-v2"
_model = None

def get_model() -> SentenceTransformer:
    """
    Lazily initialize and load the SentenceTransformer model to save startup memory.
    """
    global _model
    if _model is None:
        logger.info(f"Loading local Hugging Face SentenceTransformer model: {MODEL_NAME}...")
        try:
            # sentence-transformers cache path will default to ~/.cache/huggingface/hub
            _model = SentenceTransformer(MODEL_NAME)
            logger.info("SentenceTransformer model loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load embedding model {MODEL_NAME}: {e}")
            raise e
    return _model

def get_embedding(text: str) -> List[float]:
    """
    Generate a 384-dimensional vector embedding for a single text block.
    """
    if not text:
        return [0.0] * 384
    model = get_model()
    # encode returns a numpy array; convert it to a standard Python list of floats
    vector = model.encode(text)
    return [float(val) for val in vector]

def get_embeddings_batch(texts: List[str]) -> List[List[float]]:
    """
    Generate embeddings for a batch of text blocks.
    """
    if not texts:
        return []
    model = get_model()
    vectors = model.encode(texts)
    return [[float(val) for val in vec] for vec in vectors]
