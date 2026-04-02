"""
Database connection module for SQL Server using SQLAlchemy and pyodbc.
Provides a reusable database session and engine for the application.
"""

import os
from urllib.parse import quote_plus
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Database Configuration from Environment Variables
DB_SERVER = os.getenv("DB_SERVER", "localhost")
DB_DATABASE = os.getenv("DB_DATABASE", "master")
DB_USER = os.getenv("DB_USER", "sa")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_DRIVER = os.getenv("DB_DRIVER", "ODBC Driver 17 for SQL Server")

if not (DB_PASSWORD or "").strip():
    raise RuntimeError(
        "Invalid DB_PASSWORD. Set a non-empty DB_PASSWORD in environment variables before starting the backend."
    )

# SQL Server Connection String using pyodbc
# URL-encode special characters in credentials (especially @ in password)
# Format: mssql+pyodbc://username:password@server/database?driver=DRIVER_NAME&param=value

# URL-encode the password to handle special characters
encoded_password = quote_plus(DB_PASSWORD)
encoded_user = quote_plus(DB_USER)

connection_string = (
    f"mssql+pyodbc://{encoded_user}:{encoded_password}@{DB_SERVER}/{DB_DATABASE}"
    f"?driver={quote_plus(DB_DRIVER)}"
    f"&TrustServerCertificate=yes"
    f"&Connection+Timeout=30"
)

# Create SQLAlchemy Engine
engine = create_engine(
    connection_string,
    echo=False,  # Set to True for SQL debugging
    pool_pre_ping=True,  # Test connection before using it (prevents "connection already closed" errors)
    pool_recycle=3600,  # Recycle connections after 1 hour
)

# Create Session Factory
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

# Base class for all ORM models
Base = declarative_base()


def get_db():
    """
    Dependency injection function for FastAPI routes.
    Provides a database session for each request.
    
    Usage in routes:
        @app.get("/")
        def read_root(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_connection():
    """
    Test the database connection.
    Useful for debugging connection issues.
    """
    try:
        with engine.connect() as connection:
            result = connection.execute(text("SELECT 1"))
            print("✅ Database connection successful!")
            return True
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        return False
