"""
Pydantic schemas for request/response validation.
Used for API data serialization, deserialization, and validation.
"""

from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator


class SupplierOrderCreate(BaseModel):
    """Schema for creating a new supplier order."""
    csoid: int = Field(..., description="Customer Order ID")
    sku: str = Field(..., min_length=1, description="Product SKU")
    quantity: int = Field(..., gt=0, description="Order quantity (must be > 0)")
    supplier_name: str = Field(..., min_length=1, description="Supplier name")
    
    @field_validator("supplier_name")
    def supplier_name_not_empty(cls, v):
        """Validate that supplier_name is not empty or whitespace."""
        if not v.strip():
            raise ValueError("Supplier name cannot be empty or whitespace")
        return v.strip()
    
    @field_validator("sku")
    def sku_not_empty(cls, v):
        """Validate that SKU is not empty."""
        if not v.strip():
            raise ValueError("SKU cannot be empty")
        return v.strip().upper()


class SupplierDashboardCreate(BaseModel):
    """Schema for supplier payload submitted by frontend dashboard."""

    vendorOrderDate: str
    soid: str | None = None
    vendorOrderNumber: str = Field(..., min_length=1)
    vendorName: str = Field(..., min_length=1)
    sku: str = Field(..., min_length=1)
    quantity: int = Field(..., gt=0)
    unitPrice: float = 0
    subtotal: float = 0
    taxRate: float = 0
    tax: float = 0
    shipping: float = 0
    discount: float = 0
    grandTotal: float = 0
    refund: float = 0
    components: str = ""
    website: str = Field(..., min_length=1)
    csoid: int | None = None
    custOrderNumber: str = Field(..., min_length=1)
    productName: str | None = None

    @field_validator("vendorName")
    def vendor_name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Vendor name cannot be empty")
        return v.strip()

    @field_validator("sku")
    def dashboard_sku_not_empty(cls, v):
        if not v.strip():
            raise ValueError("SKU cannot be empty")
        return v.strip().upper()

    @field_validator("soid")
    def soid_valid(cls, v):
        if v is None:
            return v
        cleaned = v.strip()
        if not cleaned:
            return None
        if not cleaned.isdigit():
            raise ValueError("SOID must be numeric")
        return cleaned

    @field_validator("custOrderNumber")
    def cust_order_number_valid(cls, v):
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("CustOrderNumber cannot be empty")
        return cleaned

    @field_validator("vendorOrderDate")
    def vendor_order_date_valid(cls, v):
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Vendor order date is required")
        return cleaned

    @field_validator("vendorOrderNumber")
    def vendor_order_number_valid(cls, v):
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Vendor order number cannot be empty")
        return cleaned

    @field_validator("website")
    def website_valid(cls, v):
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Website must be selected")
        return cleaned

    @field_validator("unitPrice", "subtotal", "taxRate", "tax", "shipping", "discount", "grandTotal", "refund")
    def non_negative_numbers(cls, v):
        if v is None:
            return 0
        if v < 0:
            raise ValueError("Values must be >= 0")
        return v

    @field_validator("quantity")
    def quantity_valid(cls, v):
        if v is None or int(v) <= 0:
            raise ValueError("Quantity must be > 0")
        return v


class SupplierOrderUpdate(BaseModel):
    """Schema for updating a supplier order."""
    status: str = Field(..., description="Order status (e.g., 'pending', 'confirmed', 'shipped')")
    
    @field_validator("status")
    def status_valid(cls, v):
        """Validate status is one of allowed values."""
        allowed_statuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"]
        if v.lower() not in allowed_statuses:
            raise ValueError(f"Status must be one of: {', '.join(allowed_statuses)}")
        return v.lower()


class SupplierOrderResponse(BaseModel):
    """Schema for API response when returning a supplier order."""
    soid: str
    csoid: int
    cust_order_number: str | None = None
    sku: str
    quantity: int
    supplier_name: str
    vendor_order_date: date | None = None
    vendor_order_number: str | None = None
    vendor_name: str | None = None
    unit_price: float | None = None
    subtotal: float | None = None
    tax_rate: float | None = None
    tax: float | None = None
    shipping: float | None = None
    discount: float | None = None
    grand_total: float | None = None
    refund: float | None = None
    components: str | None = None
    website: str | None = None
    status: str
    created_at: datetime
    
    class Config:
        from_attributes = True  # Allows ORM model to Pydantic conversion


class OrderItem(BaseModel):
    """Schema for individual order items from CustomerOrderItems."""
    item_id: int
    sku: str
    product_name: str
    quantity: int
    product_price: float = None
    item_total: float = None
    
    class Config:
        from_attributes = True


class OrderWithItems(BaseModel):
    """Schema for complete order with all its items."""
    order_id: int
    csoid: int
    order_number: str = None
    order_date: datetime = None
    total_amount: float = None
    order_status: str = None
    items: list[OrderItem]
    
    class Config:
        from_attributes = True
