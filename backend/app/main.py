from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
import os
from dotenv import load_dotenv
from app.db.database import Base, SessionLocal, engine
from app.models.models import SupplierOrder, User
from app.auth import hash_password

# Load environment variables
load_dotenv()

# Create FastAPI app
app = FastAPI(
    title="Supplier Order Automation System",
    description="API for managing supplier orders",
    version="1.0.0"
)

# Add CORS middleware for frontend integration (future)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Change to specific domains in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check endpoint
@app.get("/health")
async def health_check():
    """Simple health check endpoint"""
    return {
        "status": "healthy",
        "message": "Supplier Order System API is running"
    }


@app.on_event("startup")
def initialize_database():
    # Creates only mapped tables that do not exist (supplier_orders).
    Base.metadata.create_all(bind=engine)
    ensure_supplier_orders_columns()
    seed_admin_user()


def seed_admin_user():
    """Create a default admin user if one does not exist."""
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == "admin@local.com").first()
        if existing:
            return
        user = User(
            email="admin@local.com",
            hashed_password=hash_password("ordertarcker@123"),
            role="admin",
        )
        db.add(user)
        db.commit()
    finally:
        db.close()


def ensure_supplier_orders_columns():
    """Ensure supplier_orders contains all dashboard fields on existing databases."""
    ddl_statements = [
        "IF COL_LENGTH('supplier_orders', 'vendor_order_date') IS NULL ALTER TABLE supplier_orders ADD vendor_order_date DATE NULL",
        """
        IF COL_LENGTH('supplier_orders', 'soid') IS NULL
           AND COL_LENGTH('supplier_orders', 'our_order_number') IS NOT NULL
        BEGIN
            EXEC sp_rename 'supplier_orders.our_order_number', 'soid', 'COLUMN';
        END
        """,
        "IF COL_LENGTH('supplier_orders', 'soid') IS NULL ALTER TABLE supplier_orders ADD soid NVARCHAR(100) NULL",
        "IF COL_LENGTH('supplier_orders', 'vendor_order_number') IS NULL ALTER TABLE supplier_orders ADD vendor_order_number NVARCHAR(100) NULL",
        "IF COL_LENGTH('supplier_orders', 'vendor_name') IS NULL ALTER TABLE supplier_orders ADD vendor_name NVARCHAR(255) NULL",
        "IF COL_LENGTH('supplier_orders', 'unit_price') IS NULL ALTER TABLE supplier_orders ADD unit_price FLOAT NULL",
        "IF COL_LENGTH('supplier_orders', 'subtotal') IS NULL ALTER TABLE supplier_orders ADD subtotal FLOAT NULL",
        "IF COL_LENGTH('supplier_orders', 'tax_rate') IS NULL ALTER TABLE supplier_orders ADD tax_rate FLOAT NULL",
        "IF COL_LENGTH('supplier_orders', 'tax') IS NULL ALTER TABLE supplier_orders ADD tax FLOAT NULL",
        "IF COL_LENGTH('supplier_orders', 'shipping') IS NULL ALTER TABLE supplier_orders ADD shipping FLOAT NULL",
        "IF COL_LENGTH('supplier_orders', 'discount') IS NULL ALTER TABLE supplier_orders ADD discount FLOAT NULL",
        "IF COL_LENGTH('supplier_orders', 'grand_total') IS NULL ALTER TABLE supplier_orders ADD grand_total FLOAT NULL",
        "IF COL_LENGTH('supplier_orders', 'refund') IS NULL ALTER TABLE supplier_orders ADD refund FLOAT NULL",
        "IF COL_LENGTH('supplier_orders', 'components') IS NULL ALTER TABLE supplier_orders ADD components NVARCHAR(MAX) NULL",
        "IF COL_LENGTH('supplier_orders', 'website') IS NULL ALTER TABLE supplier_orders ADD website NVARCHAR(100) NULL",
        "IF COL_LENGTH('supplier_orders', 'cust_order_number') IS NULL ALTER TABLE supplier_orders ADD cust_order_number NVARCHAR(100) NULL",
        "IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_supplier_orders_our_order_number' AND object_id = OBJECT_ID('supplier_orders')) DROP INDEX ux_supplier_orders_our_order_number ON supplier_orders",
        "IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_supplier_orders_soid' AND object_id = OBJECT_ID('supplier_orders')) DROP INDEX ux_supplier_orders_soid ON supplier_orders",
        """
        DECLARE @uq NVARCHAR(200);
        SELECT @uq = kc.name
        FROM sys.key_constraints kc
        JOIN sys.tables t ON kc.parent_object_id = t.object_id
        WHERE t.name = 'supplier_orders' AND kc.type = 'UQ';

        IF @uq IS NOT NULL
        BEGIN
            EXEC('ALTER TABLE supplier_orders DROP CONSTRAINT ' + @uq);
        END
        """,
        """
        DECLARE @base INT;
        SELECT @base = CASE
            WHEN MAX(TRY_CONVERT(INT, soid)) IS NULL THEN 9999
            WHEN MAX(TRY_CONVERT(INT, soid)) < 10000 THEN 9999
            ELSE MAX(TRY_CONVERT(INT, soid))
        END
        FROM supplier_orders;

        ;WITH numbered AS (
            SELECT csoid, sku, ROW_NUMBER() OVER (ORDER BY csoid, sku, created_at) AS rn
            FROM supplier_orders
            WHERE soid IS NULL OR LTRIM(RTRIM(soid)) = ''
        )
        UPDATE so
        SET soid = CAST(@base + n.rn AS NVARCHAR(100))
        FROM supplier_orders so
        JOIN numbered n ON so.csoid = n.csoid AND so.sku = n.sku;
        """,
        """
        DECLARE @pk NVARCHAR(200);
        SELECT @pk = kc.name
        FROM sys.key_constraints kc
        JOIN sys.tables t ON kc.parent_object_id = t.object_id
        WHERE t.name = 'supplier_orders' AND kc.type = 'PK';

        IF @pk IS NOT NULL
        BEGIN
            EXEC('ALTER TABLE supplier_orders DROP CONSTRAINT ' + @pk);
        END
        """,
        "IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('supplier_orders') AND name = 'soid') ALTER TABLE supplier_orders ALTER COLUMN soid NVARCHAR(100) NOT NULL",
        """
        IF NOT EXISTS (
            SELECT 1
            FROM sys.key_constraints kc
            JOIN sys.tables t ON kc.parent_object_id = t.object_id
            WHERE t.name = 'supplier_orders' AND kc.type = 'PK'
        )
        BEGIN
            ALTER TABLE supplier_orders ADD CONSTRAINT pk_supplier_orders_soid PRIMARY KEY (soid);
        END
        """,
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ux_supplier_orders_soid' AND object_id = OBJECT_ID('supplier_orders')) CREATE UNIQUE INDEX ux_supplier_orders_soid ON supplier_orders(soid)",
        "IF COL_LENGTH('supplier_orders', 'product_name') IS NOT NULL ALTER TABLE supplier_orders DROP COLUMN product_name",
        "IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_supplier_orders_id' AND object_id = OBJECT_ID('supplier_orders')) DROP INDEX ix_supplier_orders_id ON supplier_orders",
        "IF COL_LENGTH('supplier_orders', 'id') IS NOT NULL ALTER TABLE supplier_orders DROP COLUMN id",
    ]

    with engine.begin() as connection:
        for ddl in ddl_statements:
            connection.execute(text(ddl))

# Route imports
from app.routes.auth_routes import router as auth_router
from app.routes.compat_routes import router as compat_router

# Include routers
app.include_router(compat_router)
app.include_router(auth_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        reload=True
    )
