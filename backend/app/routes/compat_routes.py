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


def _load_website_prefix_mappings(db: Session) -> list[tuple[str, str]]:
    rows = db.execute(
        text(
            """
            SELECT prefix, website_name
            FROM website_mapping
            ORDER BY LEN(prefix) DESC
            """
        )
    ).fetchall()
    return [(str(row[0] or "").upper(), str(row[1] or "Unknown")) for row in rows]


def _detect_website_from_order_id(cust_order_number: str, prefix_rows: list[tuple[str, str]]) -> str:
    """Resolve website using longest-prefix match from database rows."""
    if not cust_order_number or not isinstance(cust_order_number, str):
        return "Unknown"

    order_id_upper = cust_order_number.strip().upper()
    if not order_id_upper:
        return "Unknown"

    for prefix, website_name in prefix_rows:
        if prefix and order_id_upper.startswith(prefix):
            return website_name or "Unknown"

    return "Unknown"


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


@router.get("/supplier/website-vendor-config")
def get_website_vendor_config(db: Session = Depends(get_db)):
    """Return website options and vendor options from SQL configuration tables."""
    try:
        website_rows = db.execute(
            text(
                """
                SELECT DISTINCT website_name
                FROM website_vendor_mapping
                ORDER BY website_name ASC
                """
            )
        ).fetchall()

        vendor_rows = db.execute(
            text(
                """
                SELECT website_name, vendor_name
                FROM website_vendor_mapping
                ORDER BY website_name ASC, vendor_name ASC
                """
            )
        ).fetchall()

        website_vendor_map: dict[str, list[str]] = {}
        for row in vendor_rows:
            website_name = str(row[0] or "").strip()
            vendor_name = str(row[1] or "").strip()
            if not website_name or not vendor_name:
                continue
            website_vendor_map.setdefault(website_name, []).append(vendor_name)

        return {
            "websiteOptions": [str(row[0]) for row in website_rows if row[0]],
            "websiteVendorMap": website_vendor_map,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to load website vendor config: {str(exc)}",
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

        # Guard against any session-level SQL Server row cap (e.g., ROWCOUNT 100)
        # that can silently truncate results even when no TOP/LIMIT is used.
        db.execute(text("SET ROWCOUNT 0"))

        # When a time filter is applied, return oldest orders first.
        order_by_sql = "co.OrderedDate ASC, co.CSOID ASC" if cleaned_filter_type else "co.CSOID DESC"

        query = text(
            f"""
            SELECT
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
                co.PaymentTransId,
                ISNULL(co.vendor_filled, 0) as vendor_filled
            FROM CustomerOrders co
            {where_sql}
            ORDER BY {order_by_sql}
            """
        )

        rows = db.execute(query, query_params).fetchall()

        if (cleaned_csoid or cleaned_order_ref) and not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No orders found for the provided CSOID/PO",
            )

        prefix_rows = _load_website_prefix_mappings(db)

        result = []
        for row in rows:
            website = _detect_website_from_order_id(row[1], prefix_rows)
            result.append({
                "CSOID": row[0],
                "CustOrderNumber": row[1],
                "website": website,
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
                "vendor_filled": bool(row[16]),
                "vendor_filled_display": "Filled" if row[16] else "Not Filled",
            })
        return result
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
