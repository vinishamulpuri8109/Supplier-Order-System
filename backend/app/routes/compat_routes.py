"""Compatibility routes for frontend dashboard integration."""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db.database import get_db
from app.models.models import SupplierOrder
from app.schemas import SupplierDashboardCreate


router = APIRouter(tags=["dashboard-compat"], dependencies=[Depends(get_current_user)])


@router.get("/supplier/soid-exists/{soid}")
def soid_exists(soid: str, db: Session = Depends(get_db)):
    exists = db.query(SupplierOrder).filter(SupplierOrder.soid == soid).first() is not None
    return {"exists": exists}


@router.get("/supplier/next-order-number")
def get_next_order_number(db: Session = Depends(get_db)):
    """Generate the next sequential OurOrderNumber value."""
    try:
        query = text(
            """
            SELECT MAX(TRY_CONVERT(INT, soid))
            FROM supplier_orders
            WHERE soid IS NOT NULL
            """
        )
        result = db.execute(query).scalar()
        base_number = max(result or 0, 9999)
        next_number = base_number + 1
        return {"orderNumber": str(next_number)}
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate order number: {str(exc)}",
        )


@router.get("/orders")
def search_orders(
    search: str = "",
    csoid: str = "",
    filterType: str = "",
    filterDate: str = "",
    filterStartDate: str = "",
    filterEndDate: str = "",
    db: Session = Depends(get_db),
):
    """Search orders by text and optional day/week/range OrderedDate filter."""
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

        if cleaned_filter_type and cleaned_filter_type not in {"day", "week", "range"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="filterType must be 'day', 'week', or 'range'",
            )

        if cleaned_filter_type == "range":
            cleaned_start_date = filterStartDate.strip()
            cleaned_end_date = filterEndDate.strip()
            if not cleaned_start_date or not cleaned_end_date:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="filterStartDate and filterEndDate are required when filterType is 'range'",
                )
        elif cleaned_filter_type and not cleaned_filter_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="filterDate is required when filterType is provided",
            )

        if cleaned_filter_type == "range":
            try:
                parsed_start = datetime.strptime(filterStartDate.strip(), "%Y-%m-%d").date()
                parsed_end = datetime.strptime(filterEndDate.strip(), "%Y-%m-%d").date()
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="filterStartDate and filterEndDate must be in YYYY-MM-DD format",
                ) from exc

            if parsed_end < parsed_start:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="filterEndDate must be on or after filterStartDate",
                )

            range_end = parsed_end + timedelta(days=1)
            where_clauses.append("co.OrderedDate >= :range_start")
            where_clauses.append("co.OrderedDate < :range_end")
            query_params["range_start"] = parsed_start
            query_params["range_end"] = range_end
        elif cleaned_filter_type:
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
        if resolved_csoid is None and entry.custOrderNumber:
            lookup = text(
                """
                SELECT TOP 1 co.CSOID
                FROM CustomerOrders co
                WHERE co.CustOrderNumber = :order_number
                ORDER BY co.CSOID DESC
                """
            )
            resolved_row = db.execute(
                lookup, {"order_number": entry.custOrderNumber.strip()}
            ).fetchone()
            if resolved_row:
                resolved_csoid = int(resolved_row[0])

        if resolved_csoid is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unable to resolve CSOID from payload",
            )

        csoid_exists = db.execute(
            text("SELECT TOP 1 1 FROM CustomerOrders WHERE CSOID = :csoid"),
            {"csoid": resolved_csoid},
        ).fetchone()
        if not csoid_exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CSOID does not exist in CustomerOrders",
            )

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

        if vendor_order_date and vendor_order_date > datetime.utcnow().date():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="vendorOrderDate cannot be in the future",
            )

        if not entry.website:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Website is required",
            )

        if not entry.vendorOrderNumber or not entry.vendorOrderNumber.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Vendor order number is required",
            )

        if entry.unitPrice <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unit price must be greater than 0",
            )

        if entry.quantity <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Quantity must be greater than 0",
            )

        expected_subtotal = entry.unitPrice * entry.quantity
        if entry.subtotal < 0 or abs(entry.subtotal - expected_subtotal) > 0.01:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Subtotal must equal unit price * quantity",
            )

        if entry.discount < 0 or entry.discount > entry.subtotal:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Discount must be >= 0 and <= subtotal",
            )

        if entry.taxRate < 0 or entry.tax < 0 or entry.shipping < 0 or entry.refund < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tax, tax rate, shipping, and refund must be >= 0",
            )

        expected_total = entry.subtotal + entry.tax + entry.shipping - entry.discount
        if entry.grandTotal < 0 or abs(entry.grandTotal - expected_total) > 0.01:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Grand total must equal subtotal + tax + shipping - discount",
            )

        if entry.soid:
            existing_order_number = db.query(SupplierOrder).filter(
                SupplierOrder.soid == entry.soid
            ).first()
            if existing_order_number:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"SOID {entry.soid} already exists",
                )
        else:
            next_query = text(
                """
                SELECT MAX(TRY_CONVERT(INT, soid))
                FROM supplier_orders
                WHERE soid IS NOT NULL
                """
            )
            result = db.execute(next_query).scalar()
            base_number = max(result or 0, 9999)
            entry.soid = str(base_number + 1)

        new_order = SupplierOrder(
            csoid=resolved_csoid,
            sku=normalized_sku,
            cust_order_number=(entry.custOrderNumber or '').strip() or None,
            quantity=entry.quantity,
            supplier_name=supplier_name,
            vendor_order_date=vendor_order_date,
            soid=(entry.soid or "").strip() or None,
            vendor_order_number=(entry.vendorOrderNumber or "").strip() or None,
            vendor_name=supplier_name,
            unit_price=entry.unitPrice,
            subtotal=entry.subtotal,
            tax_rate=entry.taxRate,
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
            "message": "Supplier data saved successfully",
            "supplierOrder": {
                "soid": new_order.soid,
                "csoid": new_order.csoid,
                "cust_order_number": new_order.cust_order_number,
                "sku": new_order.sku,
                "quantity": new_order.quantity,
                "supplier_name": new_order.supplier_name,
                "vendor_order_date": new_order.vendor_order_date,
                "vendor_order_number": new_order.vendor_order_number,
                "vendor_name": new_order.vendor_name,
                "unit_price": new_order.unit_price,
                "subtotal": new_order.subtotal,
                "tax_rate": new_order.tax_rate,
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
