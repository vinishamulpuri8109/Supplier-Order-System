"""Compatibility routes for frontend dashboard integration."""

from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db.database import get_db
from app.models.models import SupplierOrder
from app.schemas import SupplierDashboardCreate


router = APIRouter(tags=["dashboard-compat"], dependencies=[Depends(get_current_user)])


def _as_decimal(value: float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _get_next_soid(db: Session) -> str:
    query = text(
        """
        SELECT MAX(TRY_CONVERT(INT, soid))
        FROM supplier_orders
        WHERE soid IS NOT NULL
        """
    )
    result = db.execute(query).scalar()
    base_number = max(result or 0, 9999)
    return str(base_number + 1)


@router.get("/supplier/soid-exists/{soid}")
def soid_exists(soid: str, db: Session = Depends(get_db)):
    exists = db.query(SupplierOrder).filter(SupplierOrder.soid == soid).first() is not None
    return {"exists": exists}


@router.get("/supplier/next-order-number")
def get_next_order_number(db: Session = Depends(get_db)):
    """Generate the next sequential OurOrderNumber value."""
    try:
        return {"orderNumber": _get_next_soid(db)}
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

        if cleaned_csoid and not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="The searched CSOID does not exist",
            )

        return [
            {
                "CSOID": row[0],
                "CustOrderNumber": row[1],
                "TaxAmount": row[2],
                "ShippingCharge": row[3],
                "Coupon": row[4],
                "CouponValue": row[5],
                "Subtotal": row[6],
                "TotalAmount": row[7],
                "ShippingMethod": row[8],
                "OrderedDate": row[9],
                "OrderStatusName": row[10],
                "OrderClosingDate": row[11],
                "cid": row[12],
                "ReturnAmount": row[13],
                "PaymentMethod": row[14],
                "PaymentTransId": row[15],
            }
            for row in rows
        ]
    except HTTPException:
        raise
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
        if resolved_csoid is None and entry.po:
            lookup = text(
                """
                SELECT TOP 1 co.CSOID
                FROM CustomerOrders co
                WHERE co.CustOrderNumber = :order_number
                ORDER BY co.CSOID DESC
                """
            )
            resolved_row = db.execute(
                lookup, {"order_number": entry.po.strip()}
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

        calculated_subtotal = (_as_decimal(entry.unitPrice) * Decimal(entry.quantity)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        if _as_decimal(entry.subtotal) != calculated_subtotal:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Subtotal must equal unit price * quantity",
            )

        if entry.discount < 0 or entry.discount > calculated_subtotal:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Discount must be >= 0 and <= subtotal",
            )

        if entry.tax < 0 or entry.shipping < 0 or entry.refund < 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tax, shipping, and refund must be >= 0",
            )

        calculated_grand_total = (
            calculated_subtotal
            + _as_decimal(entry.tax)
            + _as_decimal(entry.shipping)
            - _as_decimal(entry.discount)
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        if _as_decimal(entry.grandTotal) != calculated_grand_total:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Grand total must equal subtotal + tax + shipping - discount",
            )

        generated_soid = _get_next_soid(db)

        new_order = SupplierOrder(
            csoid=resolved_csoid,
            sku=normalized_sku,
            po=(entry.po or '').strip() or None,
            quantity=entry.quantity,
            supplier_name=supplier_name,
            vendor_order_date=vendor_order_date,
            soid=generated_soid,
            vendor_order_number=(entry.vendorOrderNumber or "").strip() or None,
            vendor_name=supplier_name,
            unit_price=entry.unitPrice,
            subtotal=calculated_subtotal,
            tax=entry.tax,
            shipping=entry.shipping,
            discount=entry.discount,
            grand_total=calculated_grand_total,
            refund=entry.refund,
            comments=(entry.comments or "").strip() or None,
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
                "po": new_order.po,
                "sku": new_order.sku,
                "quantity": new_order.quantity,
                "supplier_name": new_order.supplier_name,
                "vendor_order_date": new_order.vendor_order_date,
                "vendor_order_number": new_order.vendor_order_number,
                "vendor_name": new_order.vendor_name,
                "unit_price": new_order.unit_price,
                "subtotal": new_order.subtotal,
                "tax": new_order.tax,
                "shipping": new_order.shipping,
                "discount": new_order.discount,
                "grand_total": new_order.grand_total,
                "refund": new_order.refund,
                "comments": new_order.comments,
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
