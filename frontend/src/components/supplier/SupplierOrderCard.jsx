import { useMemo } from 'react';

const formatMoney = (value) => Number(Number(value || 0).toFixed(2)).toFixed(2);
const roundToTwo = (value) => Number(Number(value || 0).toFixed(2));
const ORDER_STATUSES = ['confirmed', 'backordered', 'cancelled', 'returned'];

export default function SupplierOrderCard({
  order,
  financialDraft,
  onFinancialChange,
  onItemChange,
  isEditing = false,
  onToggleEdit = () => {},
  onSave = () => {},
  isSaving = false,
  vendorOptions = [],
  previewGrandTotal,
  orderMessage = null,
}) {
  const normalizedOrder = useMemo(() => ({
    ...order,
    items: Array.isArray(order?.items) ? order.items : [],
  }), [order]);
  const orderKey = String(normalizedOrder.soid ?? normalizedOrder.draft_id ?? '');
  const currentStatus = String(normalizedOrder.status || 'confirmed').toLowerCase();

  const skuSubtotals = useMemo(() => {
    return (normalizedOrder.items || []).map((item) =>
      roundToTwo(Number(item.quantity || 0) * Number(item.unit_price || 0))
    );
  }, [normalizedOrder.items]);

  const soidSubtotal = useMemo(() => {
    return roundToTwo(skuSubtotals.reduce((acc, val) => acc + val, 0));
  }, [skuSubtotals]);
  const isReadOnly = !isEditing;
  const vendorDetailsLocked = isReadOnly || currentStatus === 'backordered';

  return (
    <article className={`supplier-order-card ${currentStatus}-card`}>
      <header className="supplier-order-head">
        <div>
          <p className="order-id-label">SOID</p>
          <h3>#{normalizedOrder.soid}</h3>
          {normalizedOrder.cust_order_number ? <p className="order-po-label">PO #{normalizedOrder.cust_order_number}</p> : null}
        </div>
        <div className="order-head-actions">
          <div className="order-action-row">
            <button type="button" className="ghost" onClick={onToggleEdit}>
              {isEditing ? 'Cancel' : 'Edit'}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!isEditing || isSaving || !normalizedOrder.soid}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
          <label className="inline-status-editor">
            Vendor
            <select
              value={financialDraft.vendor_name || normalizedOrder.vendor_name || 'None'}
              disabled={vendorDetailsLocked}
              onChange={(event) => onFinancialChange(orderKey, 'vendor_name', event.target.value)}
            >
              <option value="None">None</option>
              {vendorOptions.map((vendor) => (
                vendor === 'None' ? null : <option key={vendor} value={vendor}>{vendor}</option>
              ))}
            </select>
          </label>
          <label className="inline-status-editor">
            Status
            <select
              value={currentStatus}
              disabled={isReadOnly}
              onChange={(event) => onFinancialChange(orderKey, 'status', event.target.value)}
            >
              {ORDER_STATUSES.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {orderMessage?.text ? (
        <p className={`order-inline-message ${orderMessage.type === 'error' ? 'error-text' : 'success-text'}`}>
          {orderMessage.text}
        </p>
      ) : null}

      <div className="sku-grid">
        {normalizedOrder.items.map((item, idx) => (
          <div key={item.sku} className="sku-row">
            <div>
              <strong>{item.sku}</strong>
              <p>{item.product_name}</p>
            </div>
            <label>
              Qty
              <input
                type="number"
                min="1"
                value={item.quantity}
                disabled={isReadOnly}
                onChange={(event) => onItemChange(orderKey, item.sku, 'quantity', event.target.value)}
              />
            </label>
            <label>
              <span>Unit Price</span>
              <input
                type="text"
                value={item.unit_price}
                disabled={isReadOnly || currentStatus !== 'confirmed'}
                onChange={(event) => onItemChange(orderKey, item.sku, 'unit_price', event.target.value)}
              />
            </label>
            <div className="readonly-field">
              <span>Subtotal</span>
              <strong>${formatMoney(skuSubtotals[idx])}</strong>
            </div>
          </div>
        ))}
      </div>

      <div className="soid-subtotal-section">
        <strong>SOID Subtotal: ${formatMoney(soidSubtotal)}</strong>
      </div>

      <div className="order-meta-grid">
        <label>
          Vendor Website Order Date
          <input
            type="date"
            value={financialDraft.vendor_website_order_date}
            disabled={vendorDetailsLocked}
            onChange={(event) => onFinancialChange(orderKey, 'vendor_website_order_date', event.target.value)}
          />
        </label>
        <label>
          Vendor Website Order Number
          <input
            type="text"
            value={financialDraft.vendor_website_order_number}
            disabled={vendorDetailsLocked}
            onChange={(event) => onFinancialChange(orderKey, 'vendor_website_order_number', event.target.value)}
          />
        </label>
      </div>

      <div className="order-finance-grid">
        <label>
          Tax
          <input
            type="text"
            value={financialDraft.tax_total}
            disabled={isReadOnly}
            onChange={(event) => onFinancialChange(orderKey, 'tax_total', event.target.value)}
          />
        </label>
        <label>
          Shipping
          <input
            type="text"
            value={financialDraft.shipping_total}
            disabled={isReadOnly}
            onChange={(event) => onFinancialChange(orderKey, 'shipping_total', event.target.value)}
          />
        </label>
        <label>
          Discount
          <input
            type="text"
            value={financialDraft.discount_total}
            disabled={isReadOnly}
            onChange={(event) => onFinancialChange(orderKey, 'discount_total', event.target.value)}
          />
        </label>
        <label>
          Refund
          <input
            type="text"
            value={financialDraft.refund_total}
            disabled={isReadOnly}
            onChange={(event) => onFinancialChange(orderKey, 'refund_total', event.target.value)}
          />
        </label>
      </div>

      <label className="comments-field">
        Comments
        <textarea
          rows={2}
          value={financialDraft.comments}
          disabled={isReadOnly}
          onChange={(event) => onFinancialChange(orderKey, 'comments', event.target.value)}
        />
      </label>

      <p className="grand-total">Grand Total: ${formatMoney(previewGrandTotal)}</p>
    </article>
  );
}
