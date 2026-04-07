"""SQLAlchemy ORM models for application tables."""

from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.db.database import Base


class SupplierOrder(Base):
    """Supplier order header grouped by vendor for a CSOID."""

    __tablename__ = "supplier_orders"

    soid = Column(Integer, primary_key=True, autoincrement=True)
    csoid = Column(Integer, nullable=False, index=True)
    cust_order_number = Column(String(100), nullable=True, index=True)
    vendor_name = Column(String(255), nullable=False)
    subtotal = Column(Numeric(10, 2), nullable=False, default=0)
    tax_total = Column(Numeric(10, 2), nullable=False, default=0)
    shipping_total = Column(Numeric(10, 2), nullable=False, default=0)
    discount_total = Column(Numeric(10, 2), nullable=False, default=0)
    refund_total = Column(Numeric(10, 2), nullable=False, default=0)
    grand_total = Column(Numeric(10, 2), nullable=False, default=0)
    vendor_website_order_date = Column(Date, nullable=True)
    vendor_website_order_number = Column(String(255), nullable=True)
    comments = Column(Text, nullable=True)
    status = Column(String(50), nullable=False, default="confirmed")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    items = relationship(
        "SupplierOrderItem",
        back_populates="order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        CheckConstraint("status in ('confirmed', 'backordered', 'cancelled', 'returned')", name="ck_supplier_orders_status"),
    )

    def __repr__(self):
        return f"<SupplierOrder(soid={self.soid}, csoid={self.csoid}, vendor={self.vendor_name})>"


class SupplierOrderItem(Base):
    """Line items for supplier orders."""

    __tablename__ = "supplier_order_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    soid = Column(Integer, ForeignKey("supplier_orders.soid", ondelete="CASCADE"), nullable=False, index=True)
    csoid = Column(Integer, nullable=False, index=True)
    cust_order_number = Column(String(100), nullable=True, index=True)
    availability_status = Column(String(20), nullable=False, default="confirmed")
    expected_date = Column(Date, nullable=True)
    vendor_note = Column(String(255), nullable=True)
    sku = Column(String(120), nullable=False)
    product_name = Column(String(255), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)
    subtotal = Column(Numeric(10, 2), nullable=False)

    order = relationship("SupplierOrder", back_populates="items")

    __table_args__ = (
        UniqueConstraint("csoid", "sku", name="uq_supplier_order_items_csoid_sku"),
        UniqueConstraint("soid", "sku", name="uq_supplier_order_items_soid_sku"),
    )

    def __repr__(self):
        return f"<SupplierOrderItem(id={self.id}, soid={self.soid}, csoid={self.csoid}, sku={self.sku})>"


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
