"""Supplier order CRUD APIs."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.db.database import get_db
from app.schemas import (
    SupplierOrderBulkDeleteByPoRequest,
    SupplierOrderBulkDeleteByPoResponse,
    SupplierOrderBatchCreateRequest,
    SupplierFollowupAlertResponse,
    SupplierOrderMoveSkuRequest,
    SupplierOrderResponse,
    SupplierOrderUpdateRequest,
)
from app.services.supplier_orders_service import (
    create_supplier_orders,
    delete_supplier_order,
    delete_supplier_orders_by_po,
    get_all_backordered_orders,
    get_supplier_followup_alerts,
    get_next_soid,
    get_supplier_orders_by_csoid,
    move_sku_between_vendors,
    serialize_order,
    soid_exists as service_soid_exists,
    update_supplier_order,
)


router = APIRouter(prefix="/supplier/orders", tags=["supplier-orders"], dependencies=[Depends(get_current_user)])


@router.post("", status_code=status.HTTP_201_CREATED)
def create_orders(payload: SupplierOrderBatchCreateRequest, db: Session = Depends(get_db)):
    created_orders = create_supplier_orders(
        db=db,
        csoid=payload.csoid,
        cust_order_number=payload.cust_order_number,
        items_payload=[item.model_dump() for item in payload.items],
    )
    return {
        "orders": [serialize_order(order) for order in created_orders],
        "count": len(created_orders),
    }


@router.put("/{soid}", response_model=SupplierOrderResponse)
def update_order(soid: int, payload: SupplierOrderUpdateRequest, db: Session = Depends(get_db)):
    updated_order = update_supplier_order(
        db=db,
        soid=soid,
        order_totals=payload.model_dump(include={"tax_total", "shipping_total", "discount_total", "refund_total"}, exclude_none=True),
        item_updates=[item.model_dump(exclude_none=True) for item in payload.items],
        comments=payload.comments,
        status_value=payload.status,
        vendor_name=payload.vendor_name,
        vendor_website_order_date=payload.vendor_website_order_date,
        vendor_website_order_number=payload.vendor_website_order_number,
    )
    return serialize_order(updated_order)


@router.get("/follow-up-alerts", response_model=list[SupplierFollowupAlertResponse])
def list_followup_alerts(db: Session = Depends(get_db)):
    return get_supplier_followup_alerts(db)


@router.delete("/{soid}", status_code=status.HTTP_200_OK)
def delete_order(soid: int, db: Session = Depends(get_db)):
    delete_supplier_order(db, soid)
    return {"message": "Supplier order deleted successfully", "soid": soid}


@router.post("/delete-by-po", response_model=SupplierOrderBulkDeleteByPoResponse, status_code=status.HTTP_200_OK)
def delete_orders_by_po(payload: SupplierOrderBulkDeleteByPoRequest, db: Session = Depends(get_db)):
    return delete_supplier_orders_by_po(
        db=db,
        csoid=payload.csoid,
        cust_order_number=payload.cust_order_number,
    )


@router.post("/move-sku", status_code=status.HTTP_200_OK)
def move_sku(payload: SupplierOrderMoveSkuRequest, db: Session = Depends(get_db)):
    result = move_sku_between_vendors(
        db=db,
        csoid=payload.csoid,
        sku=payload.sku,
        target_vendor_name=payload.target_vendor_name,
    )
    return result


@router.get("/next-order-number")
def get_next_order_number(db: Session = Depends(get_db)):
    """Returns the next SOID value for display-only use in UI."""
    return {"orderNumber": get_next_soid(db)}


@router.get("/soid-exists/{soid}")
def soid_exists_endpoint(soid: int, db: Session = Depends(get_db)):
    return {"exists": service_soid_exists(db, soid)}


@router.get("/status/backordered", response_model=list[SupplierOrderResponse])
def list_all_backordered_orders(db: Session = Depends(get_db)):
    """Get all backordered supplier orders across all CSIDs."""
    orders = get_all_backordered_orders(db)
    return [serialize_order(order) for order in orders]


@router.get("/{csoid}", response_model=list[SupplierOrderResponse])
def list_orders(csoid: int, status_filter: str | None = Query(default=None, alias="status"), db: Session = Depends(get_db)):
    orders = get_supplier_orders_by_csoid(db, csoid, status_filter=status_filter)
    return [serialize_order(order) for order in orders]
