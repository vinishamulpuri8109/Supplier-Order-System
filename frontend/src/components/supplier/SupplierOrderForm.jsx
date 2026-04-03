const INPUT_FIELDS = [
  { key: 'vendorOrderDate', label: 'VendorOrderDate', type: 'date', required: true },
  { key: 'vendorOrderNumber', label: 'VendorOrderNumber' },
  { key: 'unitPrice', label: 'UnitPrice', type: 'text', inputMode: 'decimal', money: true },
  { key: 'quantity', label: 'Quantity', type: 'text', inputMode: 'numeric', integer: true, required: true },
  { key: 'subtotal', label: 'Subtotal', type: 'text', money: true, disabled: true },
  { key: 'tax', label: 'Tax', type: 'text', inputMode: 'decimal', money: true },
  { key: 'shipping', label: 'Shipping', type: 'text', inputMode: 'decimal', money: true },
  { key: 'discount', label: 'Discount', type: 'text', inputMode: 'decimal', money: true },
  { key: 'grandTotal', label: 'GrandTotal', type: 'text', money: true, disabled: true },
  { key: 'refund', label: 'Refund', type: 'text', inputMode: 'decimal', money: true },
  { key: 'comments', label: 'Comments' },
];

export default function SupplierOrderForm({
  selectedOrder,
  selectedWebsite,
  selectedVendor,
  customVendorName,
  websiteOptions,
  vendorOptions,
  onWebsiteChange,
  onVendorChange,
  onCustomVendorNameChange,
  formData,
  fieldErrors,
  formError,
  successMessage,
  saving,
  onFormChange,
  onFormBlur,
  onSave,
  onClear,
}) {
  const formDisabled = !selectedOrder || saving;
  const requiredMissing =
    !formData.soid ||
    !formData.vendorOrderDate ||
    !formData.vendorOrderNumber ||
    !formData.vendorName ||
    !formData.sku ||
    !formData.quantity ||
    !formData.unitPrice ||
    !formData.subtotal ||
    !formData.grandTotal ||
    !selectedWebsite;

  return (
    <section className="panel">
      <h3>Supplier Entry Form</h3>

      {!selectedOrder ? (
        <p className="status-text">Select an order in the top section to enable this form.</p>
      ) : null}

      {formError ? <p className="status-text error-text">{formError}</p> : null}
      {successMessage ? <p className="status-text success-text">{successMessage}</p> : null}

      <div className="form-grid">
        <label className="field-block">
          <span>
            SOID <strong className="req">*</strong>
          </span>
          <input
            type="text"
            value={formData.soid}
            readOnly
            disabled={formDisabled}
          />
          {fieldErrors.soid ? <small className="error-text">{fieldErrors.soid}</small> : null}
        </label>

        <label className="field-block">
          <span>CSOID</span>
          <input type="text" value={selectedOrder?.CSOID ?? selectedOrder?.csoid ?? ''} readOnly />
          {fieldErrors.csoid ? <small className="error-text">{fieldErrors.csoid}</small> : null}
        </label>

        <label className="field-block">
          <span>PO</span>
          <input
            type="text"
            value={selectedOrder?.CustOrderNumber ?? selectedOrder?.po ?? selectedOrder?.order_number ?? ''}
            readOnly
          />
          {fieldErrors.po ? (
            <small className="error-text">{fieldErrors.po}</small>
          ) : null}
        </label>

        <label className="field-block">
          <span>
            SKU <strong className="req">*</strong>
          </span>
          <input type="text" value={formData.sku} readOnly disabled={formDisabled} />
          {fieldErrors.sku ? <small className="error-text">{fieldErrors.sku}</small> : null}
        </label>

        <label className="field-block">
          <span>Website</span>
          <select
            value={selectedWebsite}
            disabled={formDisabled}
            onChange={(event) => onWebsiteChange(event.target.value)}
          >
            <option value="">Select website</option>
            {websiteOptions.map((website) => (
              <option key={website} value={website}>
                {website}
              </option>
            ))}
          </select>
          {fieldErrors.website ? <small className="error-text">{fieldErrors.website}</small> : null}
        </label>

        <label className="field-block">
          <span>
            VendorName <strong className="req">*</strong>
          </span>
          <select
            value={selectedVendor}
            disabled={formDisabled || !selectedWebsite}
            onChange={(event) => onVendorChange(event.target.value)}
          >
            <option value="">Select vendor</option>
            {vendorOptions.map((vendor) => (
              <option key={vendor} value={vendor}>
                {vendor}
              </option>
            ))}
          </select>
          {selectedVendor === 'Other' ? (
            <input
              type="text"
              value={customVendorName}
              disabled={formDisabled}
              onChange={(event) => onCustomVendorNameChange(event.target.value)}
              placeholder="Type vendor name"
            />
          ) : null}
          {fieldErrors.vendorName ? <small className="error-text">{fieldErrors.vendorName}</small> : null}
        </label>

        {INPUT_FIELDS.map((field) => (
          <label key={field.key} className="field-block">
            <span>
              {field.label} {field.required ? <strong className="req">*</strong> : null}
            </span>
            <input
              type={field.type || 'text'}
              value={formData[field.key]}
              readOnly={Boolean(field.readOnly || field.disabled)}
              disabled={formDisabled || Boolean(field.disabled)}
              step={field.key === 'quantity' ? 1 : undefined}
              inputMode={field.inputMode}
              pattern={field.integer ? '\\d*' : field.money ? '\\d*(?:\\.\\d{0,2})?' : undefined}
              onChange={(event) => onFormChange(field.key, event.target.value)}
              onBlur={field.money || field.integer ? (event) => onFormBlur(field.key, event.target.value) : undefined}
            />
            {fieldErrors[field.key] ? <small className="error-text">{fieldErrors[field.key]}</small> : null}
          </label>
        ))}
      </div>

      <div className="button-row">
        <button type="button" onClick={onSave} disabled={formDisabled || requiredMissing}>
          {saving ? 'Saving...' : 'Save Supplier Data'}
        </button>
        <button type="button" className="ghost" onClick={onClear} disabled={saving}>
          Clear Form
        </button>
      </div>
    </section>
  );
}
