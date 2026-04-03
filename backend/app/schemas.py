"""
Pydantic schemas for request/response validation.
Used for API data serialization, deserialization, and validation.
"""

from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

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
    unitPrice: Decimal = Field(default=Decimal('0.00'), ge=0, max_digits=18, decimal_places=2)
    subtotal: Decimal = Field(default=Decimal('0.00'), ge=0, max_digits=18, decimal_places=2)
    tax: Decimal = Field(default=Decimal('0.00'), ge=0, max_digits=18, decimal_places=2)
    shipping: Decimal = Field(default=Decimal('0.00'), ge=0, max_digits=18, decimal_places=2)
    discount: Decimal = Field(default=Decimal('0.00'), ge=0, max_digits=18, decimal_places=2)
    grandTotal: Decimal = Field(default=Decimal('0.00'), ge=0, max_digits=18, decimal_places=2)
    refund: Decimal = Field(default=Decimal('0.00'), ge=0, max_digits=18, decimal_places=2)
    comments: str = ""
    website: str = Field(..., min_length=1)
    csoid: int | None = None
    po: str = Field(..., min_length=1)
    productName: str | None = None

    @staticmethod
    def _normalize_currency_value(value, field_label: str) -> Decimal:
        if value is None:
            return Decimal("0.00")
        try:
            decimal_value = Decimal(str(value))
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise ValueError(f"{field_label} must be a valid number") from exc

        if decimal_value < 0:
            raise ValueError(f"{field_label} must be >= 0")

        rounded = decimal_value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if decimal_value != rounded:
            raise ValueError(f"{field_label} can have at most 2 decimal places")

        return rounded

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

    @field_validator("po")
    def po_valid(cls, v):
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("PO cannot be empty")
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

    @field_validator("unitPrice", "subtotal", "tax", "shipping", "discount", "grandTotal", "refund")
    def non_negative_numbers(cls, v, info):
        return cls._normalize_currency_value(v, info.field_name)

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
    po: str | None = None
    sku: str
    quantity: int
    supplier_name: str
    vendor_order_date: date | None = None
    vendor_order_number: str | None = None
    vendor_name: str | None = None
    unit_price: float | None = None
    subtotal: float | None = None
    tax: float | None = None
    shipping: float | None = None
    discount: float | None = None
    grand_total: float | None = None
    refund: float | None = None
    comments: str | None = None
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


class UserLogin(BaseModel):
    email: str = Field(..., min_length=3)
    password: str = Field(..., min_length=1)

    @field_validator("email")
    def login_email_valid(cls, v):
        cleaned = v.strip().lower()
        if "@" not in cleaned or "." not in cleaned:
            raise ValueError("Email is invalid")
        return cleaned


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    email: str
    role: str | None = None
