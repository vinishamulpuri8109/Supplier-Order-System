"""Compatibility routes for frontend dashboard integration."""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.models import SupplierOrder
from app.schemas import SupplierDashboardCreate


router = APIRouter(tags=["dashboard-compat"])


@router.get("/orders")
def search_orders(
    search: str = "",
    csoid: str = "",
    filterType: str = "",
    filterDate: str = "",
    db: Session = Depends(get_db),
):
    """Search orders by text and optional day/week OrderedDate filter."""
    try:
        where_clauses = []
        query_params = {}

        cleaned_csoid = csoid.strip()
        if cleaned_csoid:
            try:
                query_params["filter_csoid"] = int(cleaned_csoid)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="csoid must be a valid integer",
                ) from exc
            where_clauses.append("co.CSOID = :filter_csoid")

        cleaned_search = search.strip()
        if cleaned_search:
            where_clauses.append(
                """
                (
                    CAST(co.CustOrderNumber AS NVARCHAR(100)) LIKE :like_search
                )
                """
            )
            query_params["like_search"] = f"%{cleaned_search}%"

        cleaned_filter_type = filterType.strip().lower()
        cleaned_filter_date = filterDate.strip()

        if cleaned_filter_type and cleaned_filter_type not in {"day", "week"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="filterType must be 'day' or 'week'",
            )

        if cleaned_filter_type and not cleaned_filter_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="filterDate is required when filterType is provided",
            )

        if cleaned_filter_type:
            try:
                parsed_date = datetime.strptime(cleaned_filter_date, "%Y-%m-%d").date()
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="filterDate must be in YYYY-MM-DD format",
                ) from exc

            if cleaned_filter_type == "day":
                where_clauses.append("CAST(co.OrderedDate AS DATE) = :filter_day")
                query_params["filter_day"] = parsed_date
            else:
                week_start = parsed_date - timedelta(days=parsed_date.weekday())
                week_end = week_start + timedelta(days=7)
                where_clauses.append("co.OrderedDate >= :week_start")
                where_clauses.append("co.OrderedDate < :week_end")
                query_params["week_start"] = week_start
                query_params["week_end"] = week_end

        where_sql = ""
        if where_clauses:
            where_sql = "WHERE " + " AND ".join(where_clauses)

        query = text(
            f"""
            SELECT TOP 100
                co.CSOID,
                co.CustOrderNumber,
                co.TaxRate,
                co.TaxAmount,
                co.ShippingCharge,
                co.Coupon,
                co.CouponValue,
                co.Subtotal,
                co.TotalAmount,
                co.ShippingMethod,
                co.OrderedDate,
                co.OrderStatusName,
                co.OrderClosingDate,
                co.cid,
                co.ReturnAmount,
                co.PaymentMethod,
                co.PaymentTransId
            FROM CustomerOrders co
            {where_sql}
            ORDER BY co.CSOID DESC
            """
        )

        rows = db.execute(query, query_params).fetchall()

        return [
            {
                "CSOID": row[0],
                "CustOrderNumber": row[1],
                "TaxRate": row[2],
                "TaxAmount": row[3],
                "ShippingCharge": row[4],
                "Coupon": row[5],
                "CouponValue": row[6],
                "Subtotal": row[7],
                "TotalAmount": row[8],
                "ShippingMethod": row[9],
                "OrderedDate": row[10],
                "OrderStatusName": row[11],
                "OrderClosingDate": row[12],
                "cid": row[13],
                "ReturnAmount": row[14],
                "PaymentMethod": row[15],
                "PaymentTransId": row[16],
            }
            for row in rows
        ]
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch orders: {str(exc)}",
        )


@router.get("/order-items/{csoid}")
def get_order_items(csoid: int, db: Session = Depends(get_db)):
    """Fetch order items by CSOID."""
    try:
        query = text(
            """
            SELECT
                coi.ordritmId,
                coi.Sku,
                coi.ProductName,
                coi.Quantity,
                coi.ProductPrice,
                coi.ItemTotal,
                coi.CSOID
            FROM CustomerOrderItems coi
            WHERE coi.CSOID = :csoid
            ORDER BY coi.ordritmId
            """
        )
        rows = db.execute(query, {"csoid": csoid}).fetchall()

        return [
            {
                "orderItemId": row[0],
                "Sku": row[1],
                "ProductName": row[2],
                "Quantity": row[3],
                "ProductPrice": row[4],
                "ItemTotal": row[5],
                "CSOID": row[6],
            }
            for row in rows
        ]
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch order items: {str(exc)}",
        )


@router.post("/supplier", status_code=status.HTTP_201_CREATED)
def create_supplier_entry(entry: SupplierDashboardCreate, db: Session = Depends(get_db)):
    """Accept frontend supplier payload and persist supplier order."""
    try:
        resolved_csoid = entry.csoid
        if resolved_csoid is None and entry.ourOrderNumber:
            lookup = text(
                """
                SELECT TOP 1 co.CSOID
                FROM CustomerOrders co
                WHERE co.CustOrderNumber = :order_number
                ORDER BY co.CSOID DESC
                """
            )
            resolved_row = db.execute(lookup, {"order_number": entry.ourOrderNumber}).fetchone()
            if resolved_row:
                resolved_csoid = int(resolved_row[0])

        if resolved_csoid is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unable to resolve CSOID from payload",
            )

        product_name = (entry.productName or "").strip() or entry.components.strip() or "UNKNOWN"
        supplier_name = entry.vendorName.strip()
        normalized_sku = entry.sku.strip().upper()

        vendor_order_date = None
        if entry.vendorOrderDate:
            try:
                vendor_order_date = datetime.strptime(entry.vendorOrderDate, "%Y-%m-%d").date()
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="vendorOrderDate must be in YYYY-MM-DD format",
                ) from exc

        existing = db.query(SupplierOrder).filter(
            (SupplierOrder.csoid == resolved_csoid) & (SupplierOrder.sku == normalized_sku)
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Supplier order already exists for CSOID {resolved_csoid} and SKU {normalized_sku}",
            )

        new_order = SupplierOrder(
            csoid=resolved_csoid,
            sku=normalized_sku,
            product_name=product_name,
            quantity=entry.quantity,
            supplier_name=supplier_name,
            vendor_order_date=vendor_order_date,
            our_order_number=(entry.ourOrderNumber or "").strip() or None,
            vendor_order_number=(entry.vendorOrderNumber or "").strip() or None,
            vendor_name=supplier_name,
            unit_price=entry.unitPrice,
            subtotal=entry.subtotal,
            tax=entry.tax,
            shipping=entry.shipping,
            discount=entry.discount,
            grand_total=entry.grandTotal,
            refund=entry.refund,
            components=(entry.components or "").strip() or None,
            website=(entry.website or "").strip() or None,
            status="pending",
        )
        db.add(new_order)
        db.commit()
        db.refresh(new_order)

        return {
            "id": new_order.id,
            "message": "Supplier data saved successfully",
            "supplierOrder": {
                "id": new_order.id,
                "csoid": new_order.csoid,
                "sku": new_order.sku,
                "product_name": new_order.product_name,
                "quantity": new_order.quantity,
                "supplier_name": new_order.supplier_name,
                "vendor_order_date": new_order.vendor_order_date,
                "our_order_number": new_order.our_order_number,
                "vendor_order_number": new_order.vendor_order_number,
                "vendor_name": new_order.vendor_name,
                "unit_price": new_order.unit_price,
                "subtotal": new_order.subtotal,
                "tax": new_order.tax,
                "shipping": new_order.shipping,
                "discount": new_order.discount,
                "grand_total": new_order.grand_total,
                "refund": new_order.refund,
                "components": new_order.components,
                "website": new_order.website,
                "status": new_order.status,
                "created_at": new_order.created_at,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save supplier data: {str(exc)}",
        )
