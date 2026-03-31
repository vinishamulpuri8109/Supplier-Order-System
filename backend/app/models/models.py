"""
SQLAlchemy ORM Models for the application.
Defines database table structures and relationships.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Date, Float, Text
from app.db.database import Base


class SupplierOrder(Base):
    """
    ORM Model for supplier_orders table.
    
    Attributes:
        our_order_number: Primary key (sequential order number)
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
    
    # our_order_number is the primary key (soid)
    soid = Column("our_order_number", String(100), primary_key=True, nullable=False)
    website = Column(String(100), nullable=True)
    vendor_order_date = Column(Date, nullable=True)
    vendor_order_number = Column(String(100), nullable=True)
    vendor_name = Column(String(255), nullable=True)
    sku = Column(String(50), nullable=False)
    csoid = Column(Integer, nullable=False)
    cust_order_number = Column(String(100), nullable=True)
    quantity = Column(Integer, nullable=False)
    supplier_name = Column(String(255), nullable=False)
    unit_price = Column(Float, nullable=True)
    subtotal = Column(Float, nullable=True)
    tax_rate = Column(Float, nullable=True)
    tax = Column(Float, nullable=True)
    shipping = Column(Float, nullable=True)
    discount = Column(Float, nullable=True)
    grand_total = Column(Float, nullable=True)
    refund = Column(Float, nullable=True)
    components = Column(Text, nullable=True)
    
    status = Column(String(50), default="pending", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    __table_args__ = ()
    
    def __repr__(self):
        return (
            f"<SupplierOrder(soid={self.soid}, csoid={self.csoid}, "
            f"sku={self.sku}, supplier={self.supplier_name})>"
        )
