from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import json
from app.core.database import Base

class Repository(Base):
    __tablename__ = "repositories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True, nullable=False)
    clone_url = Column(String, nullable=False)
    local_path = Column(String, nullable=True)
    status = Column(String, default="connected")  # connected, indexing, ready, failed
    created_at = Column(DateTime, default=datetime.utcnow)

    files = relationship("CodeFile", back_populates="repository", cascade="all, delete-orphan")

class CodeFile(Base):
    __tablename__ = "code_files"

    id = Column(Integer, primary_key=True, index=True)
    repository_id = Column(Integer, ForeignKey("repositories.id", ondelete="CASCADE"), nullable=False)
    relative_path = Column(String, index=True, nullable=False)
    content = Column(Text, nullable=True)
    hash = Column(String, nullable=True)  # MD5 or SHA256 of file content
    created_at = Column(DateTime, default=datetime.utcnow)

    repository = relationship("Repository", back_populates="files")
    chunks = relationship("CodeChunk", back_populates="code_file", cascade="all, delete-orphan")

class CodeChunk(Base):
    __tablename__ = "code_chunks"

    id = Column(Integer, primary_key=True, index=True)
    code_file_id = Column(Integer, ForeignKey("code_files.id", ondelete="CASCADE"), nullable=False)
    chunk_index = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    start_line = Column(Integer, nullable=False)
    end_line = Column(Integer, nullable=False)
    _embedding = Column("embedding", Text, nullable=True)  # Stored as JSON string
    created_at = Column(DateTime, default=datetime.utcnow)

    code_file = relationship("CodeFile", back_populates="chunks")

    @property
    def embedding(self):
        if self._embedding:
            return json.loads(self._embedding)
        return []

    @embedding.setter
    def embedding(self, value):
        if value is not None:
            self._embedding = json.dumps(value)
        else:
            self._embedding = None
