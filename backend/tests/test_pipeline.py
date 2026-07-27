import os
import sys
import logging
import json

# Add parent directory to sys.path so we can import 'app'
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.database import Base, engine, SessionLocal
from app.models.code import Repository, CodeFile, CodeChunk
from app.services.embeddings import get_embedding, MODEL_NAME
from app.services.parser import chunk_file_content
from app.services.vector_store import search_codebase

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def test_pipeline():
    logger.info("=== Starting Automated Stage 2 Verification Pipeline ===")
    
    # 1. Test local Hugging Face model loading
    logger.info("1. Testing SentenceTransformer embedding generation...")
    test_text = "def database_connect(): pass"
    emb = get_embedding(test_text)
    
    logger.info(f"Successfully generated embedding using local '{MODEL_NAME}' model.")
    logger.info(f"Vector Dimensions: {len(emb)} (Expected: 384)")
    assert len(emb) == 384, "Embedding dimensions must be exactly 384 for all-MiniLM-L6-v2."
    
    # 2. Test database tables creation
    logger.info("2. Initializing SQLite tables...")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    
    try:
        # 3. Create dummy repository
        logger.info("3. Creating mock repository...")
        repo = db.query(Repository).filter(Repository.name == "mock-repo").first()
        if repo:
            db.delete(repo)
            db.commit()
            
        repo = Repository(
            name="mock-repo",
            clone_url="https://github.com/mock/repo.git",
            local_path="./mock-repo",
            status="connected"
        )
        db.add(repo)
        db.commit()
        db.refresh(repo)
        logger.info(f"Created Repository record: ID={repo.id}, Name={repo.name}")
        
        # 4. Insert dummy code files and generate chunks
        logger.info("4. Inserting and chunking mock code file...")
        sample_code = """
# Database connector utility
import os
import sqlite3

def establish_connection_to_sqlite(db_file_path):
    \"\"\"
    Establish a connection to the local SQLite database file.
    \"\"\"
    try:
        connection = sqlite3.connect(db_file_path)
        print("Successfully connected to SQLite.")
        return connection
    except Exception as error:
        print(f"Error connecting to database: {error}")
        return None

def fetch_all_users_from_db(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users")
    return cursor.fetchall()
"""
        
        code_file = CodeFile(
            repository_id=repo.id,
            relative_path="utils/db.py",
            content=sample_code,
            hash="mockhash123"
        )
        db.add(code_file)
        db.commit()
        
        # Chunk content
        chunks = chunk_file_content(sample_code)
        logger.info(f"Split file into {len(chunks)} text chunks.")
        
        # Embed and insert chunks
        logger.info("Embedding chunks...")
        for idx, chunk in enumerate(chunks):
            chunk_emb = get_embedding(chunk["content"])
            chunk_obj = CodeChunk(
                code_file_id=code_file.id,
                chunk_index=idx,
                content=chunk["content"],
                start_line=chunk["start_line"],
                end_line=chunk["end_line"]
            )
            chunk_obj.embedding = chunk_emb
            db.add(chunk_obj)
            
        db.commit()
        logger.info("Saved chunks and vector embeddings to database.")
        
        # Update repo status
        repo.status = "ready"
        db.commit()
        
        # 5. Execute semantic searches
        logger.info("5. Testing semantic search queries...")
        queries = [
            "how to connect to sqlite database",
            "select users query"
        ]
        
        for q in queries:
            logger.info(f"\nQuery: '{q}'")
            results = search_codebase(db, repo.id, q, top_k=2)
            
            for rank, res in enumerate(results):
                logger.info(f"  Match {rank+1}: {res['file_path']} (lines {res['start_line']}-{res['end_line']})")
                logger.info(f"  Similarity: {res['similarity']:.4f}")
                logger.info(f"  Snippet snippet: {res['content'].strip().splitlines()[0]}")
                
            assert len(results) > 0, "Semantic search did not return any matches."
            
        logger.info("\n=== All Tests Passed Successfully! ===")
        
    finally:
        # Cleanup
        db.delete(repo)
        db.commit()
        db.close()

if __name__ == "__main__":
    test_pipeline()
