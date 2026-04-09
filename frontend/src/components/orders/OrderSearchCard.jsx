const ORDER_COLUMNS = [
  'CSOID',
  'PO',
  'TaxAmount',
  'ShippingCharge',
  'Coupon',
  'CouponValue',
  'Subtotal',
  'TotalAmount',
  'ShippingMethod',
  'OrderedDate',
  'OrderStatusName',
  'OrderClosingDate',
  'cid',
  'ReturnAmount',
  'PaymentMethod',
  'PaymentTransId',
];

const ORDER_FIELD_MAP = {
  CSOID: ['CSOID', 'csoid'],
  PO: ['CustOrderNumber', 'po', 'order_number'],
  TaxAmount: ['TaxAmount', 'tax_amount'],
  ShippingCharge: ['ShippingCharge', 'shipping_charge'],
  Coupon: ['Coupon', 'coupon'],
  CouponValue: ['CouponValue', 'coupon_value'],
  Subtotal: ['Subtotal', 'subtotal'],
  TotalAmount: ['TotalAmount', 'total_amount'],
  ShippingMethod: ['ShippingMethod', 'shipping_method'],
  OrderedDate: ['OrderedDate', 'order_date'],
  OrderStatusName: ['OrderStatusName', 'order_status'],
  OrderClosingDate: ['OrderClosingDate', 'order_closing_date'],
  cid: ['cid'],
  ReturnAmount: ['ReturnAmount', 'return_amount'],
  PaymentMethod: ['PaymentMethod', 'payment_method'],
  PaymentTransId: ['PaymentTransId', 'payment_trans_id'],
};

function getOrderFieldValue(order, column) {
  const candidates = ORDER_FIELD_MAP[column] || [column];
  for (const key of candidates) {
    if (key in order) {
      if (order[key] === null) {
        return 'null';
      }
      if (order[key] !== undefined) {
        return String(order[key]);
      }
    }
  }
  return '';
}

function getOrderRowId(order) {
  return String(order.CSOID ?? order.csoid ?? order.CustOrderNumber ?? order.po ?? order.order_number ?? '');
}

export default function OrderSearchCard({
  csoidSearchValue,
  onCsoidSearchValueChange,
  filterType,
  onFilterTypeChange,
  filterStartDate,
  filterEndDate,
  onFilterStartDateChange,
  onFilterEndDateChange,
  onClearDateFilter,
  onSearch,
  orders,
  loading,
  error,
  selectedOrder,
  onSelectOrder,
}) {
  const datePresets = [
    { label: 'Today', value: 'today' },
    { label: 'Yesterday', value: 'yesterday' },
    { label: 'This week', value: 'this_week' },
    { label: 'Last week', value: 'last_week' },
    { label: 'This month', value: 'this_month' },
  ];

  const selectedId = getOrderRowId(selectedOrder || {});

  const onSearchSubmit = (event) => {
    event.preventDefault();
    onSearch();
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>CustomerOrders</h3>
        <form className="search-form" onSubmit={onSearchSubmit}>
          <div className="po-filter-row">
            <input
              type="text"
              value={csoidSearchValue}
              onChange={(event) => onCsoidSearchValueChange(event.target.value)}
              placeholder="Enter PO"
              aria-label="Enter PO"
            />
            <button
              type="button"
              className="ghost quick-po-clear"
              onClick={() => onCsoidSearchValueChange('')}
              disabled={!csoidSearchValue.trim()}
            >
              clear PO
            </button>
          </div>
          <div className="quick-filter-tabs" role="group" aria-label="Quick date filters">
            {datePresets.map((preset) => (
              <button
                key={preset.value}
                type="button"
                className={`quick-filter-tab ${filterType === preset.value ? 'active' : ''}`}
                onClick={() => {
                  if (filterType === preset.value) {
                    onClearDateFilter();
                    return;
                  }
                  onFilterTypeChange(preset.value);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="quick-filter-range-row">
            <span className="quick-filter-range-label">Filter by date</span>
            <input
              type="date"
              value={filterStartDate}
              onChange={(event) => {
                onFilterTypeChange('custom');
                onFilterStartDateChange(event.target.value);
              }}
              aria-label="Filter by date start"
              title="Filter by date (start)"
            />
            <span className="quick-filter-arrow" aria-hidden="true">{'->'}</span>
            <input
              type="date"
              value={filterEndDate}
              onChange={(event) => {
                onFilterTypeChange('custom');
                onFilterEndDateChange(event.target.value);
              }}
              aria-label="Filter by date end"
              title="Filter by date (end)"
            />
            <button type="button" className="ghost quick-filter-clear" onClick={onClearDateFilter}>
              clear
            </button>
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>
      </div>

      {error ? <p className="status-text error-text">{error}</p> : null}
      {loading ? <p className="status-text">Loading customer orders...</p> : null}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {ORDER_COLUMNS.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && orders.length === 0 ? (
              <tr>
                <td colSpan={ORDER_COLUMNS.length} className="empty-cell">
                  Search by PO and use quick date presets or a custom range.
                </td>
              </tr>
            ) : null}

            {orders.map((order, index) => {
              const rowId = getOrderRowId(order);
              const isSelected = rowId !== '' && rowId === selectedId;
              const stableRowId = rowId || `order-${index}`;

              return (
                <tr
                  key={stableRowId}
                  className={isSelected ? 'selected-row' : ''}
                  onClick={() => onSelectOrder(order)}
                >
                  {ORDER_COLUMNS.map((column) => (
                    <td key={`${stableRowId}-${column}`}>{getOrderFieldValue(order, column)}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
