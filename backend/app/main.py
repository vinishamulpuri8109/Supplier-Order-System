from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import text
import logging
import os
from pathlib import Path
from dotenv import load_dotenv
from app.db.database import Base, SessionLocal, engine
from app.models.models import User
from app.auth import hash_password

# Load environment variables
load_dotenv()

logger = logging.getLogger("uvicorn.error")


def _get_allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "")
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    if not origins:
        raise RuntimeError(
            "Invalid ALLOWED_ORIGINS. Set ALLOWED_ORIGINS as a comma-separated list of allowed origins."
        )
    return origins


def _is_admin_seed_enabled() -> bool:
    return (os.getenv("ENABLE_ADMIN_SEED", "false").strip().lower() == "true")

# Create FastAPI app
app = FastAPI(
    title="Supplier Order Automation System",
    description="API for managing supplier orders",
    version="1.0.0"
)

# Add CORS middleware for frontend integration (future)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_allowed_origins(),
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
    # Enforce supplier schema first, then create any remaining mapped tables.
    ensure_supplier_order_schema()
    Base.metadata.create_all(bind=engine)
    if _is_admin_seed_enabled():
        logger.info("Admin seeding enabled; running seed_admin_user().")
        seed_admin_user()
    else:
        logger.info("Admin seeding disabled; skipping seed_admin_user().")


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


def ensure_supplier_order_schema():
    """Ensure supplier order tables match required structure."""
    ddl_statements = [
        """
        IF OBJECT_ID('supplier_orders', 'U') IS NOT NULL
        BEGIN
            DECLARE @is_compatible BIT = 0;
            IF EXISTS (
                SELECT 1
                FROM sys.columns c
                JOIN sys.types t ON c.user_type_id = t.user_type_id
                WHERE c.object_id = OBJECT_ID('supplier_orders')
                  AND c.name = 'soid'
                  AND t.name = 'int'
                  AND c.is_identity = 1
            )
            AND COL_LENGTH('supplier_orders', 'tax_total') IS NOT NULL
            AND COL_LENGTH('supplier_orders', 'shipping_total') IS NOT NULL
            AND COL_LENGTH('supplier_orders', 'discount_total') IS NOT NULL
            AND COL_LENGTH('supplier_orders', 'refund_total') IS NOT NULL
            BEGIN
                SET @is_compatible = 1;
            END

            IF @is_compatible = 0
            BEGIN
                IF OBJECT_ID('supplier_order_items', 'U') IS NOT NULL DROP TABLE supplier_order_items;
                DROP TABLE supplier_orders;
            END
        END
        """,
        """
        IF OBJECT_ID('supplier_orders', 'U') IS NULL
        BEGIN
            CREATE TABLE supplier_orders (
                soid INT IDENTITY(10000,1) PRIMARY KEY,
                csoid INT NOT NULL,
                cust_order_number NVARCHAR(100) NULL,
                vendor_name NVARCHAR(255) NOT NULL,
                subtotal DECIMAL(10,2) NOT NULL CONSTRAINT df_supplier_orders_subtotal DEFAULT (0),
                tax_total DECIMAL(10,2) NOT NULL CONSTRAINT df_supplier_orders_tax_total DEFAULT (0),
                shipping_total DECIMAL(10,2) NOT NULL CONSTRAINT df_supplier_orders_shipping_total DEFAULT (0),
                discount_total DECIMAL(10,2) NOT NULL CONSTRAINT df_supplier_orders_discount_total DEFAULT (0),
                refund_total DECIMAL(10,2) NOT NULL CONSTRAINT df_supplier_orders_refund_total DEFAULT (0),
                grand_total DECIMAL(10,2) NOT NULL CONSTRAINT df_supplier_orders_grand_total DEFAULT (0),
                vendor_website_order_date DATE NULL,
                vendor_website_order_number NVARCHAR(255) NULL,
                comments NVARCHAR(MAX) NULL,
                status NVARCHAR(50) NOT NULL CONSTRAINT df_supplier_orders_status DEFAULT ('confirmed'),
                created_at DATETIME2 NOT NULL CONSTRAINT df_supplier_orders_created_at DEFAULT (SYSUTCDATETIME()),
                updated_at DATETIME2 NOT NULL CONSTRAINT df_supplier_orders_updated_at DEFAULT (SYSUTCDATETIME())
            );
        END
        """,
        """
        IF OBJECT_ID('supplier_orders', 'U') IS NOT NULL
        BEGIN
            DECLARE @max_soid INT;
            SELECT @max_soid = ISNULL(MAX(soid), 0) FROM supplier_orders;

            IF @max_soid = 0
            BEGIN
                -- Empty table: next insert uses reseed value itself.
                DBCC CHECKIDENT ('supplier_orders', RESEED, 10000);
            END
            ELSE IF @max_soid < 10000
            BEGIN
                -- Non-empty table: next insert uses reseed + 1.
                DBCC CHECKIDENT ('supplier_orders', RESEED, 9999);
            END
        END
        """,
        "IF OBJECT_ID('supplier_orders', 'U') IS NOT NULL AND COL_LENGTH('supplier_orders', 'vendor_website_order_date') IS NULL ALTER TABLE supplier_orders ADD vendor_website_order_date DATE NULL",
        "IF OBJECT_ID('supplier_orders', 'U') IS NOT NULL AND COL_LENGTH('supplier_orders', 'cust_order_number') IS NULL ALTER TABLE supplier_orders ADD cust_order_number NVARCHAR(100) NULL",
        "IF OBJECT_ID('supplier_orders', 'U') IS NOT NULL AND COL_LENGTH('supplier_orders', 'vendor_website_order_number') IS NULL AND COL_LENGTH('supplier_orders', 'vendor_website_order_name') IS NOT NULL BEGIN EXEC sp_rename 'supplier_orders.vendor_website_order_name', 'vendor_website_order_number', 'COLUMN'; END",
        "IF OBJECT_ID('supplier_orders', 'U') IS NOT NULL AND COL_LENGTH('supplier_orders', 'vendor_website_order_number') IS NULL ALTER TABLE supplier_orders ADD vendor_website_order_number NVARCHAR(255) NULL",
        "IF OBJECT_ID('supplier_orders', 'U') IS NOT NULL AND COL_LENGTH('supplier_orders', 'followup_date') IS NOT NULL ALTER TABLE supplier_orders DROP COLUMN followup_date",
        "IF OBJECT_ID('supplier_orders', 'U') IS NOT NULL AND COL_LENGTH('supplier_orders', 'followup_note') IS NOT NULL ALTER TABLE supplier_orders DROP COLUMN followup_note",
        "IF OBJECT_ID('supplier_orders', 'U') IS NOT NULL UPDATE supplier_orders SET status = CASE WHEN status IN ('draft', 'available') OR status IS NULL THEN 'confirmed' WHEN status = 'unavailable' THEN 'cancelled' ELSE LOWER(status) END",
        "IF OBJECT_ID('supplier_orders', 'U') IS NOT NULL AND EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_supplier_orders_status') ALTER TABLE supplier_orders DROP CONSTRAINT ck_supplier_orders_status",
        "IF OBJECT_ID('supplier_orders', 'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'ck_supplier_orders_status') ALTER TABLE supplier_orders ADD CONSTRAINT ck_supplier_orders_status CHECK (status IN ('confirmed', 'backordered', 'cancelled', 'returned'))",
        """
        IF OBJECT_ID('supplier_order_items', 'U') IS NOT NULL AND COL_LENGTH('supplier_order_items', 'id') IS NOT NULL
        BEGIN
            IF OBJECT_ID('supplier_order_items_new', 'U') IS NOT NULL DROP TABLE supplier_order_items_new;

            CREATE TABLE supplier_order_items_new (
                soid INT NOT NULL,
                csoid INT NOT NULL,
                cust_order_number NVARCHAR(100) NULL,
                availability_status NVARCHAR(20) NOT NULL CONSTRAINT df_supplier_order_items_new_availability DEFAULT ('confirmed'),
                expected_date DATE NULL,
                vendor_note NVARCHAR(255) NULL,
                sku NVARCHAR(120) NOT NULL,
                product_name NVARCHAR(255) NOT NULL,
                quantity INT NOT NULL,
                unit_price DECIMAL(10,2) NOT NULL,
                subtotal DECIMAL(10,2) NOT NULL,
                CONSTRAINT pk_supplier_order_items_new PRIMARY KEY (soid, sku),
                CONSTRAINT fk_supplier_order_items_new_soid FOREIGN KEY (soid) REFERENCES supplier_orders(soid) ON DELETE CASCADE
            );

            INSERT INTO supplier_order_items_new (
                soid,
                csoid,
                cust_order_number,
                availability_status,
                expected_date,
                vendor_note,
                sku,
                product_name,
                quantity,
                unit_price,
                subtotal
            )
            SELECT
                soid,
                csoid,
                cust_order_number,
                availability_status,
                expected_date,
                vendor_note,
                sku,
                product_name,
                quantity,
                unit_price,
                subtotal
            FROM supplier_order_items;

            DROP TABLE supplier_order_items;
            EXEC sp_rename 'supplier_order_items_new', 'supplier_order_items';
        END
        """,
        """
        IF OBJECT_ID('supplier_order_items', 'U') IS NULL
        BEGIN
            CREATE TABLE supplier_order_items (
                soid INT NOT NULL,
                csoid INT NOT NULL,
                cust_order_number NVARCHAR(100) NULL,
                availability_status NVARCHAR(20) NOT NULL CONSTRAINT df_supplier_order_items_availability DEFAULT ('confirmed'),
                expected_date DATE NULL,
                vendor_note NVARCHAR(255) NULL,
                sku NVARCHAR(120) NOT NULL,
                product_name NVARCHAR(255) NOT NULL,
                quantity INT NOT NULL,
                unit_price DECIMAL(10,2) NOT NULL,
                subtotal DECIMAL(10,2) NOT NULL,
                CONSTRAINT pk_supplier_order_items PRIMARY KEY (soid, sku),
                CONSTRAINT fk_supplier_order_items_soid FOREIGN KEY (soid) REFERENCES supplier_orders(soid) ON DELETE CASCADE
            );
        END
        """,
        "IF OBJECT_ID('supplier_order_items', 'U') IS NOT NULL AND COL_LENGTH('supplier_order_items', 'cust_order_number') IS NULL ALTER TABLE supplier_order_items ADD cust_order_number NVARCHAR(100) NULL",
        "IF OBJECT_ID('supplier_order_items', 'U') IS NOT NULL AND COL_LENGTH('supplier_order_items', 'availability_status') IS NULL ALTER TABLE supplier_order_items ADD availability_status NVARCHAR(20) NOT NULL CONSTRAINT df_supplier_order_items_availability DEFAULT ('confirmed')",
        "IF OBJECT_ID('supplier_order_items', 'U') IS NOT NULL UPDATE supplier_order_items SET availability_status = CASE WHEN availability_status IN ('available', 'draft') OR availability_status IS NULL THEN 'confirmed' WHEN availability_status = 'unavailable' THEN 'cancelled' ELSE LOWER(availability_status) END",
        "IF OBJECT_ID('supplier_order_items', 'U') IS NOT NULL AND COL_LENGTH('supplier_order_items', 'expected_date') IS NULL ALTER TABLE supplier_order_items ADD expected_date DATE NULL",
        "IF OBJECT_ID('supplier_order_items', 'U') IS NOT NULL AND COL_LENGTH('supplier_order_items', 'vendor_note') IS NULL ALTER TABLE supplier_order_items ADD vendor_note NVARCHAR(255) NULL",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_supplier_orders_csoid' AND object_id = OBJECT_ID('supplier_orders')) CREATE INDEX ix_supplier_orders_csoid ON supplier_orders(csoid)",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_supplier_orders_cust_order_number' AND object_id = OBJECT_ID('supplier_orders')) CREATE INDEX ix_supplier_orders_cust_order_number ON supplier_orders(cust_order_number)",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_supplier_order_items_soid' AND object_id = OBJECT_ID('supplier_order_items')) CREATE INDEX ix_supplier_order_items_soid ON supplier_order_items(soid)",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_supplier_order_items_csoid' AND object_id = OBJECT_ID('supplier_order_items')) CREATE INDEX ix_supplier_order_items_csoid ON supplier_order_items(csoid)",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_supplier_order_items_cust_order_number' AND object_id = OBJECT_ID('supplier_order_items')) CREATE INDEX ix_supplier_order_items_cust_order_number ON supplier_order_items(cust_order_number)",
        "IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_supplier_order_items_csoid_sku' AND object_id = OBJECT_ID('supplier_order_items')) CREATE UNIQUE INDEX uq_supplier_order_items_csoid_sku ON supplier_order_items(csoid, sku)",
        "IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'uq_supplier_order_items_soid_sku' AND object_id = OBJECT_ID('supplier_order_items')) DROP INDEX uq_supplier_order_items_soid_sku ON supplier_order_items",
    ]

    with engine.begin() as connection:
        for ddl in ddl_statements:
            connection.execute(text(ddl))

# Route imports
from app.routes.auth_routes import router as auth_router
from app.routes.compat_routes import router as compat_router
from app.routes.supplier_order_routes import router as supplier_order_router

# Include routers
app.include_router(compat_router)
app.include_router(auth_router)
app.include_router(supplier_order_router)


FRONTEND_DIST_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"
FRONTEND_INDEX_HTML = FRONTEND_DIST_DIR / "index.html"


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    """Serve the frontend SPA for non-API routes when a build is available."""
    first_segment = full_path.split("/", 1)[0]
    api_routes = {"health", "orders", "order-items", "supplier", "login", "auth"}

    if first_segment in api_routes:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    requested_path = FRONTEND_DIST_DIR / full_path
    if requested_path.is_file():
        return FileResponse(requested_path)

    if requested_path.suffix:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    if FRONTEND_INDEX_HTML.is_file():
        return FileResponse(FRONTEND_INDEX_HTML)

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Frontend build not found")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8000,
        reload=True
    )
