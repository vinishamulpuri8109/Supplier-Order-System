"""
SQLAlchemy ORM Models for the application.
Defines database table structures and relationships.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Date, Float, Text, UniqueConstraint
from app.db.database import Base


class SupplierOrder(Base):
    """
    ORM Model for supplier_orders table.
    
    Attributes:
        id: Primary key (auto-incremented)
        csoid: Customer Order ID (from CustomerOrders table)
        sku: Product SKU
        product_name: Name of the product
        quantity: Order quantity
        supplier_name: Name of the supplier (manually entered by user)
        status: Order status (default: "pending")
        created_at: Timestamp when record was created
    
    Constraint:
        - (csoid, sku) must be unique to prevent duplicate supplier orders
    """
    
    __tablename__ = "supplier_orders"
    
    id = Column(Integer, primary_key=True, index=True)
    csoid = Column(Integer, nullable=False)
    sku = Column(String(50), nullable=False)
    product_name = Column(String(255), nullable=False)
    quantity = Column(Integer, nullable=False)
    supplier_name = Column(String(255), nullable=False)
    vendor_order_date = Column(Date, nullable=True)
    our_order_number = Column(String(100), nullable=True)
    vendor_order_number = Column(String(100), nullable=True)
    vendor_name = Column(String(255), nullable=True)
    unit_price = Column(Float, nullable=True)
    subtotal = Column(Float, nullable=True)
    tax = Column(Float, nullable=True)
    shipping = Column(Float, nullable=True)
    discount = Column(Float, nullable=True)
    grand_total = Column(Float, nullable=True)
    refund = Column(Float, nullable=True)
    components = Column(Text, nullable=True)
    website = Column(String(100), nullable=True)
    status = Column(String(50), default="pending", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Unique constraint on (csoid, sku) combination
    __table_args__ = (
        UniqueConstraint("csoid", "sku", name="uq_csoid_sku"),
    )
    
    def __repr__(self):
        return f"<SupplierOrder(id={self.id}, csoid={self.csoid}, sku={self.sku}, supplier={self.supplier_name})>"
