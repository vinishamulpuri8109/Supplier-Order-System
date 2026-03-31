const INPUT_FIELDS = [
  { key: 'vendorOrderDate', label: 'VendorOrderDate', type: 'date', required: true },
  { key: 'ourOrderNumber', label: 'OurOrderNumber', readOnly: true },
  { key: 'vendorOrderNumber', label: 'VendorOrderNumber' },
  { key: 'sku', label: 'SKU', required: true, readOnly: true },
  { key: 'unitPrice', label: 'UnitPrice', type: 'number' },
  { key: 'quantity', label: 'Quantity', type: 'number', required: true },
  { key: 'subtotal', label: 'Subtotal', type: 'number' },
  { key: 'tax', label: 'Tax', type: 'number' },
  { key: 'shipping', label: 'Shipping', type: 'number' },
  { key: 'discount', label: 'Discount', type: 'number' },
  { key: 'grandTotal', label: 'GrandTotal', type: 'number', readOnly: true },
  { key: 'refund', label: 'Refund', type: 'number' },
  { key: 'components', label: 'Components' },
];

export default function SupplierOrderForm({
  selectedOrder,
  selectedWebsite,
  selectedVendor,
  websiteOptions,
  vendorOptions,
  onWebsiteChange,
  onVendorChange,
  formData,
  fieldErrors,
  formError,
  successMessage,
  saving,
  onFormChange,
  onSave,
  onClear,
}) {
  const formDisabled = !selectedOrder || saving;

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
              readOnly={Boolean(field.readOnly)}
              disabled={formDisabled}
              onChange={(event) => onFormChange(field.key, event.target.value)}
            />
            {fieldErrors[field.key] ? <small className="error-text">{fieldErrors[field.key]}</small> : null}
          </label>
        ))}
      </div>

      <div className="button-row">
        <button type="button" onClick={onSave} disabled={formDisabled}>
          {saving ? 'Saving...' : 'Save Supplier Data'}
        </button>
        <button type="button" className="ghost" onClick={onClear} disabled={saving}>
          Clear Form
        </button>
      </div>
    </section>
  );
}
