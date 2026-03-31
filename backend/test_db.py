"""
Quick test script to verify database connection with diagnostics.
Run this from the backend folder: python test_db.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
import pyodbc

# Load environment variables
load_dotenv()

if __name__ == "__main__":
    print("=" * 60)
    print("DATABASE CONNECTION TEST")
    print("=" * 60)
    
    # Read connection details
    DB_SERVER = os.getenv("DB_SERVER")
    DB_DATABASE = os.getenv("DB_DATABASE")
    DB_USER = os.getenv("DB_USER")
    DB_PASSWORD = os.getenv("DB_PASSWORD")
    DB_DRIVER = os.getenv("DB_DRIVER")
    
    print(f"\nConnection Details:")
    print(f"  Server: {DB_SERVER}")
    print(f"  Database: {DB_DATABASE}")
    print(f"  User: {DB_USER}")
    print(f"  Driver: {DB_DRIVER}")
    
    print(f"\n1. Testing direct pyodbc connection...")
    try:
        # Test with direct pyodbc connection string
        odbc_conn_string = (
            f"DRIVER={DB_DRIVER};"
            f"SERVER={DB_SERVER};"
            f"DATABASE={DB_DATABASE};"
            f"UID={DB_USER};"
            f"PWD={DB_PASSWORD};"
            f"TrustServerCertificate=yes;"
            f"Connection Timeout=30;"
        )
        
        conn = pyodbc.connect(odbc_conn_string, timeout=10)
        cursor = conn.cursor()
        cursor.execute("SELECT 1 as connection_test")
        result = cursor.fetchone()
        print(f"  ✅ SUCCESS! Query result: {result[0]}")
        conn.close()
        
    except Exception as e:
        print(f"  ❌ FAILED: {str(e)}")
    
    print(f"\n2. Testing SQLAlchemy connection...")
    try:
        from app.db.database import test_connection
        test_connection()
    except Exception as e:
        print(f"  ❌ FAILED: {str(e)}")
    
    print("\n" + "=" * 60)
