"""Compatibility routes for frontend dashboard integration."""

from datetime import datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db.database import get_db
from app.schemas import SupplierDashboardCreate
from app.services.supplier_orders_service import get_next_soid, soid_exists as service_soid_exists


router = APIRouter(tags=["dashboard-compat"], dependencies=[Depends(get_current_user)])


def _as_decimal(value: float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _get_next_soid(db: Session) -> str:
    return str(get_next_soid(db))


@router.get("/supplier/soid-exists/{soid}")
def soid_exists(soid: str, db: Session = Depends(get_db)):
    if not soid.isdigit():
        return {"exists": False}
    return {"exists": service_soid_exists(db, int(soid))}


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
    orderRef: str = "",
    search: str = "",
    csoid: str = "",
    filterType: str = "",
    filterDate: str = "",
    filterStartDate: str = "",
    filterEndDate: str = "",
    db: Session = Depends(get_db),
):
    """Search orders by text and optional preset/custom OrderedDate filter."""
    try:
        where_clauses = []
        query_params = {}

        cleaned_order_ref = orderRef.strip()
        if cleaned_order_ref:
            where_clauses.append(
                "(CAST(co.CustOrderNumber AS NVARCHAR(100)) LIKE :order_ref_like"
                " OR (:order_ref_is_numeric = 1 AND co.CSOID = :order_ref_csoid))"
            )
            query_params["order_ref_like"] = f"%{cleaned_order_ref}%"
            query_params["order_ref_is_numeric"] = 1 if cleaned_order_ref.isdigit() else 0
            query_params["order_ref_csoid"] = int(cleaned_order_ref) if cleaned_order_ref.isdigit() else -1

        cleaned_csoid = csoid.strip()
        if cleaned_csoid and not cleaned_order_ref:
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

        if cleaned_filter_type and cleaned_filter_type not in {
            "day",
            "week",
            "range",
            "custom",
            "today",
            "yesterday",
            "this_week",
            "last_week",
            "this_month",
        }:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "filterType must be one of 'day', 'week', 'range', 'custom', "
                    "'today', 'yesterday', 'this_week', 'last_week', or 'this_month'"
                ),
            )

        if cleaned_filter_type in {"range", "custom"}:
            cleaned_start_date = filterStartDate.strip()
            cleaned_end_date = filterEndDate.strip()
            if not cleaned_start_date or not cleaned_end_date:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="filterStartDate and filterEndDate are required when filterType is 'custom'",
                )
        elif cleaned_filter_type in {"day", "week"} and not cleaned_filter_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="filterDate is required when filterType is provided",
            )

        if cleaned_filter_type in {"range", "custom"}:
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
        elif cleaned_filter_type in {"day", "week"}:
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
        elif cleaned_filter_type:
            today = datetime.utcnow().date()

            if cleaned_filter_type == "today":
                range_start = today
                range_end = today + timedelta(days=1)
            elif cleaned_filter_type == "yesterday":
                range_start = today - timedelta(days=1)
                range_end = today
            elif cleaned_filter_type == "this_week":
                range_start = today - timedelta(days=today.weekday())
                range_end = range_start + timedelta(days=7)
            elif cleaned_filter_type == "last_week":
                this_week_start = today - timedelta(days=today.weekday())
                range_start = this_week_start - timedelta(days=7)
                range_end = this_week_start
            else:  # this_month
                range_start = today.replace(day=1)
                if range_start.month == 12:
                    range_end = range_start.replace(year=range_start.year + 1, month=1)
                else:
                    range_end = range_start.replace(month=range_start.month + 1)

            where_clauses.append("co.OrderedDate >= :preset_start")
            where_clauses.append("co.OrderedDate < :preset_end")
            query_params["preset_start"] = range_start
            query_params["preset_end"] = range_end

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

        if (cleaned_csoid or cleaned_order_ref) and not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No orders found for the provided CSOID/PO",
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
    """Deprecated compatibility endpoint retained to avoid silent failures."""
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail="Endpoint deprecated. Use POST /supplier/orders for grouped supplier order creation.",
    )
