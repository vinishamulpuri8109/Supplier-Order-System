"""
Pydantic schemas for request/response validation.
Used for API data serialization, deserialization, and validation.
"""

from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


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

    @model_validator(mode='after')
    def validate_vendor_fields(self):
        """When vendor is selected (not 'None'), all fields except comments must be provided."""
        is_vendor_selected = self.vendorName.strip().lower() != 'none'
        
        if is_vendor_selected:
            # Check that vendor order date is provided
            if not self.vendorOrderDate or not self.vendorOrderDate.strip():
                raise ValueError("Vendor order date is required when vendor is selected")
            
            # Check that vendor order number is provided
            if not self.vendorOrderNumber or not self.vendorOrderNumber.strip():
                raise ValueError("Vendor order number is required when vendor is selected")
        
        return self



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


class SupplierOrderItemCreate(BaseModel):
    sku: str = Field(..., min_length=1)
    product_name: str = Field(..., min_length=1)
    quantity: int = Field(..., gt=0)
    vendor_name: str = Field(..., min_length=1)
    unit_price: Decimal = Field(..., ge=0, max_digits=10, decimal_places=2)
    status: Literal["confirmed", "backordered", "cancelled", "returned"] = "confirmed"
    expected_date: date | None = None
    vendor_note: str | None = None
    vendor_website_order_date: date | None = None
    vendor_website_order_number: str | None = None

    @field_validator("sku")
    def supplier_item_sku_valid(cls, value: str) -> str:
        cleaned = value.strip().upper()
        if not cleaned:
            raise ValueError("SKU is required")
        return cleaned

    @field_validator("product_name", "vendor_name")
    def supplier_item_text_fields_valid(cls, value: str, info):
        cleaned = value.strip()
        if not cleaned:
            raise ValueError(f"{info.field_name} is required")
        return cleaned

    @field_validator("vendor_website_order_number")
    def supplier_item_order_number_valid(cls, value: str | None):
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("vendor_note")
    def vendor_note_valid(cls, value: str | None):
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class SupplierOrderBatchCreateRequest(BaseModel):
    csoid: int = Field(..., gt=0)
    cust_order_number: str | None = None
    items: list[SupplierOrderItemCreate] = Field(..., min_length=1)

    @field_validator("cust_order_number")
    def cust_order_number_valid(cls, value: str | None):
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None


class SupplierOrderItemUpdate(BaseModel):
    id: int = Field(..., gt=0)
    unit_price: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    quantity: int | None = Field(default=None, gt=0)
    status: Literal["confirmed", "backordered", "cancelled", "returned"] | None = None


class SupplierOrderUpdateRequest(BaseModel):
    tax_total: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    shipping_total: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    discount_total: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    refund_total: Decimal | None = Field(default=None, ge=0, max_digits=10, decimal_places=2)
    vendor_name: str | None = None
    vendor_website_order_date: date | None = None
    vendor_website_order_number: str | None = None
    comments: str | None = None
    status: Literal["confirmed", "backordered", "cancelled", "returned"] | None = None
    items: list[SupplierOrderItemUpdate] = Field(default_factory=list)

    @field_validator("vendor_website_order_number")
    def vendor_website_order_number_valid(cls, value: str | None):
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @field_validator("vendor_name")
    def vendor_name_valid(cls, value: str | None):
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

class SupplierOrderMoveSkuRequest(BaseModel):
    csoid: int = Field(..., gt=0)
    sku: str = Field(..., min_length=1)
    target_vendor_name: str = Field(..., min_length=1)

    @field_validator("sku")
    def move_sku_normalized(cls, value: str) -> str:
        cleaned = value.strip().upper()
        if not cleaned:
            raise ValueError("sku is required")
        return cleaned

    @field_validator("target_vendor_name")
    def target_vendor_valid(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("target_vendor_name is required")
        return cleaned


class SupplierOrderItemResponse(BaseModel):
    id: int
    soid: int
    csoid: int
    cust_order_number: str | None = None
    status: str
    availability_status: str | None = None
    expected_date: date | None = None
    vendor_note: str | None = None
    sku: str
    product_name: str
    quantity: int
    unit_price: float
    subtotal: float


class SupplierOrderResponse(BaseModel):
    soid: int
    csoid: int
    cust_order_number: str | None = None
    vendor_name: str
    subtotal: float
    tax_total: float
    shipping_total: float
    discount_total: float
    refund_total: float
    grand_total: float
    vendor_website_order_date: date | None = None
    vendor_website_order_number: str | None = None
    comments: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime
    items: list[SupplierOrderItemResponse]


class SupplierFollowupAlertResponse(BaseModel):
    soid: int
    csoid: int
    cust_order_number: str | None = None
    vendor_name: str
    status: str
    created_at: datetime
