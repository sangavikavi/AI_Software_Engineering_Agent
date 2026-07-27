import logging
from typing import List, Dict
import numpy as np
from sqlalchemy.orm import Session
from app.models.code import CodeChunk, CodeFile
from app.services.embeddings import get_embedding

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def search_codebase(db: Session, repository_id: int, query: str, top_k: int = 5) -> List[Dict]:
    """
    Perform semantic code search.
    Generates embedding for the query, fetches repository chunks from SQLite,
    calculates cosine similarity using numpy, and returns top matches.
    """
    logger.info(f"Semantically querying repository ID {repository_id} for: '{query}'")
    
    # 1. Generate query vector
    query_emb = get_embedding(query)
    query_vector = np.array(query_emb, dtype=np.float32)
    
    # 2. Fetch all database chunks for files in the repository
    chunks = db.query(CodeChunk).join(CodeFile).filter(
        CodeFile.repository_id == repository_id
    ).all()
    
    if not chunks:
        logger.warning(f"No code chunks found in DB for repository ID {repository_id}")
        return []
        
    results = []
    
    # 3. Calculate cosine similarity
    for chunk in chunks:
        chunk_emb = chunk.embedding
        if not chunk_emb:
            continue
            
        chunk_vector = np.array(chunk_emb, dtype=np.float32)
        
        # Vector Dot Product
        dot_product = np.dot(query_vector, chunk_vector)
        norm_query = np.linalg.norm(query_vector)
        norm_chunk = np.linalg.norm(chunk_vector)
        
        if norm_query == 0 or norm_chunk == 0:
            similarity = 0.0
        else:
            similarity = float(dot_product / (norm_query * norm_chunk))
            
        results.append({
            "chunk": chunk,
            "similarity": similarity
        })
        
    # 4. Sort and return top_k matches
    results.sort(key=lambda x: x["similarity"], reverse=True)
    
    top_matches = []
    for item in results[:top_k]:
        chunk = item["chunk"]
        top_matches.append({
            "file_path": chunk.code_file.relative_path,
            "start_line": chunk.start_line,
            "end_line": chunk.end_line,
            "content": chunk.content,
            "similarity": item["similarity"]
        })
        
    logger.info(f"Found {len(top_matches)} semantic matches in codebase.")
    return top_matches
