import os
import hashlib
import logging
from typing import List, Dict, Tuple
from sqlalchemy.orm import Session
from app.models.code import Repository, CodeFile, CodeChunk
from app.services.embeddings import get_embeddings_batch

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Supported programming and markup files
ALLOWED_EXTENSIONS = {
    '.py', '.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css',
    '.md', '.yml', '.yaml', '.sh', '.sql', '.dockerfile', 'Dockerfile'
}

# Directories that should be skipped during folder traversal
IGNORE_DIRS = {
    '.git', '.github', 'node_modules', '.venv', 'venv', 'env',
    '__pycache__', 'dist', 'build', '.pytest_cache', '.mypy_cache',
    'out', 'target'
}

def get_file_hash(content: str) -> str:
    """
    Calculate MD5 hash of string to detect file changes.
    """
    return hashlib.md5(content.encode('utf-8', errors='ignore')).hexdigest()

def should_parse_file(file_path: str) -> bool:
    """
    Determine if a file should be parsed based on its extension and path.
    """
    name = os.path.basename(file_path)
    
    # Check if any path segments are ignored
    parts = file_path.split(os.sep)
    for part in parts:
        if part in IGNORE_DIRS:
            return False
            
    if name.startswith('.'):
        return False
        
    _, ext = os.path.splitext(name)
    if name == 'Dockerfile' or name.lower() == 'dockerfile':
        return True
        
    return ext.lower() in ALLOWED_EXTENSIONS

def chunk_file_content(content: str, max_chunk_chars: int = 1000, overlap_lines: int = 4) -> List[Dict]:
    """
    Split file content into line-aware text chunks.
    Ensures chunks overlap by a few lines to preserve contextual boundary splits.
    """
    lines = content.splitlines(keepends=True)
    chunks = []
    
    current_lines: List[str] = []
    current_length = 0
    start_line = 1
    
    for idx, line in enumerate(lines):
        line_num = idx + 1
        current_lines.append(line)
        current_length += len(line)
        
        # Split when length limit is exceeded, or we reach the EOF
        if current_length >= max_chunk_chars or line_num == len(lines):
            chunk_text = "".join(current_lines)
            chunks.append({
                "content": chunk_text,
                "start_line": start_line,
                "end_line": line_num
            })
            
            # Slide window back by overlap_lines
            overlap_count = min(overlap_lines, len(current_lines))
            if overlap_count > 0 and line_num < len(lines):
                current_lines = current_lines[-overlap_count:]
                current_length = sum(len(l) for l in current_lines)
                start_line = line_num - overlap_count + 1
            else:
                current_lines = []
                current_length = 0
                start_line = line_num + 1
                
    return chunks

def parse_and_index_repo(db: Session, repository_id: int, base_dir: str) -> None:
    """
    Scan a local directory, chunk all source files, request embeddings, and save records.
    """
    repo = db.query(Repository).filter(Repository.id == repository_id).first()
    if not repo:
        logger.error(f"Repository {repository_id} not found in database.")
        return
        
    logger.info(f"Starting ingestion pipeline for repository '{repo.name}' at: {base_dir}")
    repo.status = "indexing"
    db.commit()
    
    try:
        # Collect all files that match parsing criteria
        files_to_parse: List[Tuple[str, str]] = []
        for root, dirs, files in os.walk(base_dir):
            # Prune ignored directories in place to prevent entering them
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            
            for file in files:
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, base_dir).replace('\\', '/')
                
                if should_parse_file(full_path):
                    files_to_parse.append((full_path, rel_path))
                    
        logger.info(f"Found {len(files_to_parse)} files to analyze in '{repo.name}'.")
        
        all_chunks_to_create: List[CodeChunk] = []
        chunk_texts_for_embeddings: List[str] = []
        
        for full_path, rel_path in files_to_parse:
            try:
                with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
            except Exception as e:
                logger.warning(f"Could not read file {full_path}: {e}")
                continue
                
            file_hash = get_file_hash(content)
            
            # Check if file has already been parsed and is unchanged
            existing_file = db.query(CodeFile).filter(
                CodeFile.repository_id == repo.id,
                CodeFile.relative_path == rel_path
            ).first()
            
            if existing_file:
                if existing_file.hash == file_hash:
                    logger.info(f"Skipping unchanged file: {rel_path}")
                    continue
                else:
                    logger.info(f"File changed; re-indexing: {rel_path}")
                    db.delete(existing_file)
                    db.commit()
            
            # Add database record for file
            code_file = CodeFile(
                repository_id=repo.id,
                relative_path=rel_path,
                content=content,
                hash=file_hash
            )
            db.add(code_file)
            db.commit() # Flush transaction to get auto-increment code_file.id
            
            # Break file content into chunks
            file_chunks = chunk_file_content(content)
            for idx, chunk_info in enumerate(file_chunks):
                chunk_obj = CodeChunk(
                    code_file_id=code_file.id,
                    chunk_index=idx,
                    content=chunk_info["content"],
                    start_line=chunk_info["start_line"],
                    end_line=chunk_info["end_line"]
                )
                all_chunks_to_create.append(chunk_obj)
                chunk_texts_for_embeddings.append(chunk_info["content"])
                
        # Generate embeddings in batches
        if all_chunks_to_create:
            logger.info(f"Generating embeddings for {len(all_chunks_to_create)} chunks...")
            batch_size = 64
            all_embeddings = []
            
            for i in range(0, len(chunk_texts_for_embeddings), batch_size):
                batch_texts = chunk_texts_for_embeddings[i:i+batch_size]
                batch_embs = get_embeddings_batch(batch_texts)
                all_embeddings.extend(batch_embs)
                
            # Connect embeddings to database models
            for chunk, emb in zip(all_chunks_to_create, all_embeddings):
                chunk.embedding = emb
                db.add(chunk)
                
            db.commit()
            logger.info(f"Stored {len(all_chunks_to_create)} text chunks & vector embeddings.")
            
        repo.status = "ready"
        db.commit()
        logger.info(f"Ingestion finished. Repository '{repo.name}' status set to ready.")
        
    except Exception as e:
        logger.error(f"Error during repository ingestion for {repo.name}: {e}")
        repo.status = "failed"
        db.commit()
