"""Business logic for supplier order CRUD and SKU moves."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.models import SupplierOrder, SupplierOrderItem

TWOPLACES = Decimal("0.01")


@dataclass
class MoneyTotals:
    subtotal: Decimal
    tax_total: Decimal
    shipping_total: Decimal
    discount_total: Decimal
    refund_total: Decimal
    grand_total: Decimal


def _money(value: Decimal | float | int | str | None, field_name: str) -> Decimal:
    if value is None or value == "":
        parsed = Decimal("0")
    else:
        try:
            parsed = Decimal(str(value))
        except Exception as exc:  # pragma: no cover - defensive
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{field_name} must be a valid decimal",
            ) from exc

    rounded = parsed.quantize(TWOPLACES, rounding=ROUND_HALF_UP)
    if parsed != rounded:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must have at most 2 decimal places",
        )
    return rounded


def _normalize_sku(raw_sku: str) -> str:
    sku = (raw_sku or "").strip().upper()
    if not sku:
        raise HTTPException(status_code=400, detail="SKU is required")
    return sku


def _normalize_vendor(raw_vendor: str) -> str:
    vendor = (raw_vendor or "").strip()
    if not vendor:
        raise HTTPException(status_code=400, detail="Vendor is required")
    return vendor


def _normalize_item_status(raw_status: str | None) -> str:
    status_value = (raw_status or "confirmed").strip().lower()
    aliases = {
        "available": "confirmed",
        "unavailable": "cancelled",
        "draft": "confirmed",
    }
    status_value = aliases.get(status_value, status_value)
    if status_value not in {"confirmed", "backordered", "cancelled", "returned"}:
        raise HTTPException(status_code=400, detail="item status must be confirmed, backordered, cancelled, or returned")
    return status_value


def _derive_order_status(item_statuses: list[str]) -> str:
    normalized = {status.strip().lower() for status in item_statuses if status}
    if "backordered" in normalized:
        return "backordered"
    if "cancelled" in normalized:
        return "cancelled"
    if "returned" in normalized:
        return "returned"
    return "confirmed"


def _calculate_item_subtotal(quantity: int, unit_price: Decimal) -> Decimal:
    if quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be greater than 0")
    if unit_price < 0:
        raise HTTPException(status_code=400, detail="Unit price must be >= 0")
    return (Decimal(quantity) * unit_price).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def _calculate_grand_total(
    subtotal: Decimal,
    tax_total: Decimal,
    shipping_total: Decimal,
    discount_total: Decimal,
    refund_total: Decimal,
) -> Decimal:
    grand_total = subtotal + tax_total + shipping_total - discount_total - refund_total
    return grand_total.quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def _refresh_order_totals(order: SupplierOrder) -> MoneyTotals:
    subtotal = sum((item.subtotal for item in order.items), Decimal("0.00")).quantize(TWOPLACES)
    tax_total = _money(order.tax_total, "tax_total")
    shipping_total = _money(order.shipping_total, "shipping_total")
    discount_total = _money(order.discount_total, "discount_total")
    refund_total = _money(order.refund_total, "refund_total")

    if discount_total > subtotal:
        raise HTTPException(status_code=400, detail="discount_total cannot exceed subtotal")

    grand_total = _calculate_grand_total(subtotal, tax_total, shipping_total, discount_total, refund_total)

    order.subtotal = subtotal
    order.tax_total = tax_total
    order.shipping_total = shipping_total
    order.discount_total = discount_total
    order.refund_total = refund_total
    order.grand_total = grand_total
    order.updated_at = datetime.utcnow()

    return MoneyTotals(subtotal, tax_total, shipping_total, discount_total, refund_total, grand_total)


def _serialize_item(item: SupplierOrderItem) -> dict:
    canonical_status = _normalize_item_status(item.availability_status)
    return {
        "id": item.id,
        "soid": item.soid,
        "csoid": item.csoid,
        "cust_order_number": item.cust_order_number,
        "status": canonical_status,
        "availability_status": canonical_status,
        "expected_date": item.expected_date,
        "vendor_note": item.vendor_note,
        "sku": item.sku,
        "product_name": item.product_name,
        "quantity": item.quantity,
        "unit_price": float(item.unit_price),
        "subtotal": float(item.subtotal),
    }


def serialize_order(order: SupplierOrder) -> dict:
    canonical_order_status = _normalize_item_status(order.status)
    return {
        "soid": order.soid,
        "csoid": order.csoid,
        "cust_order_number": order.cust_order_number,
        "vendor_name": order.vendor_name,
        "subtotal": float(order.subtotal),
        "tax_total": float(order.tax_total),
        "shipping_total": float(order.shipping_total),
        "discount_total": float(order.discount_total),
        "refund_total": float(order.refund_total),
        "grand_total": float(order.grand_total),
        "vendor_website_order_date": order.vendor_website_order_date,
        "vendor_website_order_number": order.vendor_website_order_number,
        "comments": order.comments,
        "status": canonical_order_status,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
        "items": [_serialize_item(item) for item in sorted(order.items, key=lambda x: x.id)],
    }


def get_next_soid(db: Session) -> int:
    base_soid = 10000
    existing_soids = (
        db.query(SupplierOrder.soid)
        .filter(SupplierOrder.soid >= base_soid)
        .order_by(SupplierOrder.soid.asc())
        .all()
    )

    candidate = base_soid
    for row in existing_soids:
        current_soid = int(row[0])
        if current_soid == candidate:
            candidate += 1
            continue
        if current_soid > candidate:
            break

    return candidate


def soid_exists(db: Session, soid: int) -> bool:
    existing = db.query(SupplierOrder.soid).filter(SupplierOrder.soid == soid).first()
    return existing is not None


def create_supplier_orders(
    db: Session,
    csoid: int,
    items_payload: list[dict],
    cust_order_number: str | None = None,
) -> list[SupplierOrder]:
    if not items_payload:
        raise HTTPException(status_code=400, detail="At least one SKU is required")

    grouped: dict[str, list[dict]] = {}
    seen_skus: set[str] = set()
    normalized_cust_order_number = (cust_order_number or "").strip() or None

    for incoming in items_payload:
        sku = _normalize_sku(incoming.get("sku", ""))
        if sku in seen_skus:
            raise HTTPException(status_code=400, detail=f"Duplicate SKU in payload: {sku}")
        seen_skus.add(sku)

        existing = (
            db.query(SupplierOrderItem)
            .filter(SupplierOrderItem.csoid == csoid, SupplierOrderItem.sku == sku)
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Duplicate CSOID+SKU detected for csoid={csoid}, sku={sku}",
            )

        quantity = int(incoming.get("quantity", 0))
        unit_price = _money(incoming.get("unit_price"), "unit_price")
        product_name = (incoming.get("product_name") or "").strip() or sku
        vendor_name = _normalize_vendor(incoming.get("vendor_name", ""))

        grouped.setdefault(vendor_name, []).append(
            {
                "sku": sku,
                "product_name": product_name,
                "quantity": quantity,
                "unit_price": unit_price,
                "cust_order_number": normalized_cust_order_number,
                "status": _normalize_item_status(incoming.get("status") or incoming.get("availability_status")),
                "expected_date": incoming.get("expected_date"),
                "vendor_note": (incoming.get("vendor_note") or "").strip() or None,
                "vendor_website_order_date": incoming.get("vendor_website_order_date") or None,
                "vendor_website_order_number": (incoming.get("vendor_website_order_number") or "").strip() or None,
            }
        )

    created_orders: list[SupplierOrder] = []

    for vendor_name, vendor_items in grouped.items():
        header_vendor_order_date = next(
            (item.get("vendor_website_order_date") for item in vendor_items if item.get("vendor_website_order_date")),
            None,
        )
        header_vendor_order_number = next(
            (item.get("vendor_website_order_number") for item in vendor_items if item.get("vendor_website_order_number")),
            None,
        )
        order_status = "backordered" if vendor_name == "None" else "confirmed"

        order = SupplierOrder(
            soid=get_next_soid(db),
            csoid=csoid,
            cust_order_number=normalized_cust_order_number,
            vendor_name=vendor_name,
            subtotal=Decimal("0.00"),
            tax_total=Decimal("0.00"),
            shipping_total=Decimal("0.00"),
            discount_total=Decimal("0.00"),
            refund_total=Decimal("0.00"),
            grand_total=Decimal("0.00"),
            vendor_website_order_date=header_vendor_order_date,
            vendor_website_order_number=header_vendor_order_number,
            status=order_status,
            comments=None,
        )
        db.add(order)
        db.flush()

        for payload_item in vendor_items:
            item_subtotal = _calculate_item_subtotal(payload_item["quantity"], payload_item["unit_price"])
            item = SupplierOrderItem(
                soid=order.soid,
                csoid=csoid,
                cust_order_number=normalized_cust_order_number,
                availability_status=payload_item["status"],
                expected_date=payload_item.get("expected_date"),
                vendor_note=payload_item.get("vendor_note"),
                sku=payload_item["sku"],
                product_name=payload_item["product_name"],
                quantity=payload_item["quantity"],
                unit_price=payload_item["unit_price"],
                subtotal=item_subtotal,
            )
            db.add(item)
            order.items.append(item)

        _refresh_order_totals(order)
        created_orders.append(order)

    db.commit()

    for order in created_orders:
        db.refresh(order)

    return created_orders


def get_supplier_orders_by_csoid(db: Session, csoid: int) -> list[SupplierOrder]:
    return (
        db.query(SupplierOrder)
        .filter(SupplierOrder.csoid == csoid)
        .order_by(SupplierOrder.soid.asc())
        .all()
    )


def update_supplier_order(
    db: Session,
    soid: int,
    order_totals: dict,
    item_updates: list[dict],
    comments: str | None,
    status_value: str | None,
    vendor_name: str | None,
    vendor_website_order_date,
    vendor_website_order_number,
) -> SupplierOrder:
    order = db.query(SupplierOrder).filter(SupplierOrder.soid == soid).first()
    if not order:
        raise HTTPException(status_code=404, detail="Supplier order not found")

    if comments is not None:
        order.comments = comments.strip() or None

    if vendor_name is not None:
        cleaned_vendor = vendor_name.strip()
        if not cleaned_vendor:
            raise HTTPException(status_code=400, detail="vendor_name cannot be empty")
        order.vendor_name = cleaned_vendor

    if status_value is not None:
        normalized_status = status_value.strip().lower()
        if normalized_status not in {"confirmed", "backordered", "cancelled", "returned"}:
            raise HTTPException(status_code=400, detail="status must be 'confirmed', 'backordered', 'cancelled', or 'returned'")
        order.status = normalized_status

    if vendor_website_order_date is not None:
        order.vendor_website_order_date = vendor_website_order_date

    if vendor_website_order_number is not None:
        order.vendor_website_order_number = str(vendor_website_order_number).strip() or None

    if order.vendor_name.strip().lower() == "none" and status_value is None:
        order.status = "backordered"
    elif order.vendor_name.strip().lower() != "none" and status_value is None and order.status == "backordered":
        order.status = "confirmed"

    if order_totals:
        order.tax_total = _money(order_totals.get("tax_total"), "tax_total")
        order.shipping_total = _money(order_totals.get("shipping_total"), "shipping_total")
        order.discount_total = _money(order_totals.get("discount_total"), "discount_total")
        order.refund_total = _money(order_totals.get("refund_total"), "refund_total")

    if item_updates:
        item_map = {item.id: item for item in order.items}
        for incoming in item_updates:
            item_id = int(incoming.get("id", 0))
            if item_id not in item_map:
                raise HTTPException(status_code=400, detail=f"Item id {item_id} is not part of soid {soid}")

            current_item = item_map[item_id]
            if "unit_price" in incoming:
                current_item.unit_price = _money(incoming.get("unit_price"), "unit_price")
            if "quantity" in incoming:
                quantity = int(incoming.get("quantity", 0))
                if quantity <= 0:
                    raise HTTPException(status_code=400, detail="quantity must be greater than 0")
                current_item.quantity = quantity
            if "status" in incoming:
                current_item.availability_status = _normalize_item_status(incoming.get("status"))

            current_item.subtotal = _calculate_item_subtotal(current_item.quantity, current_item.unit_price)

    _refresh_order_totals(order)

    db.commit()
    db.refresh(order)
    return order


def delete_supplier_order(db: Session, soid: int) -> None:
    order = db.query(SupplierOrder).filter(SupplierOrder.soid == soid).first()
    if not order:
        raise HTTPException(status_code=404, detail="Supplier order not found")

    db.delete(order)
    db.commit()


def move_sku_between_vendors(db: Session, csoid: int, sku: str, target_vendor_name: str) -> dict:
    normalized_sku = _normalize_sku(sku)
    normalized_vendor = _normalize_vendor(target_vendor_name)

    item = (
        db.query(SupplierOrderItem)
        .filter(SupplierOrderItem.csoid == csoid, SupplierOrderItem.sku == normalized_sku)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="SKU not found for provided CSOID")

    source_order = db.query(SupplierOrder).filter(SupplierOrder.soid == item.soid).first()
    if not source_order:
        raise HTTPException(status_code=404, detail="Source supplier order not found")

    if source_order.vendor_name == normalized_vendor:
        _refresh_order_totals(source_order)
        db.commit()
        db.refresh(source_order)
        return {
            "source_order": serialize_order(source_order),
            "target_order": serialize_order(source_order),
            "message": "SKU already belongs to target vendor",
        }

    target_order = (
        db.query(SupplierOrder)
        .filter(
            SupplierOrder.csoid == csoid,
            SupplierOrder.vendor_name == normalized_vendor,
            SupplierOrder.soid != source_order.soid,
        )
        .first()
    )

    created_target = False
    if not target_order:
        target_order = SupplierOrder(
            csoid=csoid,
            cust_order_number=source_order.cust_order_number,
            vendor_name=normalized_vendor,
            subtotal=Decimal("0.00"),
            tax_total=Decimal("0.00"),
            shipping_total=Decimal("0.00"),
            discount_total=Decimal("0.00"),
            refund_total=Decimal("0.00"),
            grand_total=Decimal("0.00"),
            status="confirmed",
            comments=None,
        )
        db.add(target_order)
        db.flush()
        created_target = True

    item.soid = target_order.soid
    item.csoid = csoid
    db.flush()
    db.expire(target_order, ["items"])
    db.expire(source_order, ["items"])

    _refresh_order_totals(target_order)

    if len(source_order.items) > 0:
        _refresh_order_totals(source_order)
    else:
        db.delete(source_order)
        source_order = None

    db.commit()

    db.refresh(target_order)
    if source_order:
        db.refresh(source_order)

    return {
        "source_order": serialize_order(source_order) if source_order else None,
        "target_order": serialize_order(target_order),
        "created_target_order": created_target,
        "source_deleted": source_order is None,
    }


def get_supplier_followup_alerts(db: Session) -> list[dict]:
    cutoff = datetime.utcnow() - timedelta(days=1)

    rows = (
        db.query(SupplierOrder)
        .filter(SupplierOrder.status == "backordered")
        .filter(SupplierOrder.created_at < cutoff)
        .order_by(SupplierOrder.created_at.asc())
        .all()
    )

    return [
        {
            "soid": row.soid,
            "csoid": row.csoid,
            "cust_order_number": row.cust_order_number,
            "vendor_name": row.vendor_name,
            "status": row.status,
            "created_at": row.created_at,
        }
        for row in rows
    ]
