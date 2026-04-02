"""
SQLAlchemy ORM Models for the application.
Defines database table structures and relationships.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Date, Numeric, Text
from app.db.database import Base


class SupplierOrder(Base):
    """
    ORM Model for supplier_orders table.
    
    Attributes:
        soid: Primary key (sequential order number)
        csoid: Customer Order ID (from CustomerOrders table)
        sku: Product SKU
        quantity: Order quantity
        supplier_name: Name of the supplier (manually entered by user)
        status: Order status (default: "pending")
        created_at: Timestamp when record was created
    
    Constraint:
        - our_order_number is the primary key
    """
    
    __tablename__ = "supplier_orders"
    
    # soid is the primary key
    soid = Column("soid", String(100), primary_key=True, nullable=False)
    website = Column(String(100), nullable=True)
    vendor_order_date = Column(Date, nullable=True)
    vendor_order_number = Column(String(100), nullable=True)
    vendor_name = Column(String(255), nullable=True)
    sku = Column(String(50), nullable=False)
    csoid = Column(Integer, nullable=False)
    po = Column(String(100), nullable=True)
    quantity = Column(Integer, nullable=False)
    supplier_name = Column(String(255), nullable=False)
    unit_price = Column(Numeric(18, 2), nullable=True)
    subtotal = Column(Numeric(18, 2), nullable=True)
    tax = Column(Numeric(18, 2), nullable=True)
    shipping = Column(Numeric(18, 2), nullable=True)
    discount = Column(Numeric(18, 2), nullable=True)
    grand_total = Column(Numeric(18, 2), nullable=True)
    refund = Column(Numeric(18, 2), nullable=True)
    comments = Column(Text, nullable=True)
    
    status = Column(String(50), default="pending", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    __table_args__ = ()
    
    def __repr__(self):
        return (
            f"<SupplierOrder(soid={self.soid}, csoid={self.csoid}, "
            f"sku={self.sku}, supplier={self.supplier_name})>"
        )


class User(Base):
    """User account for authentication."""

    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="user")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<User(id={self.id}, email={self.email}, role={self.role})>"
