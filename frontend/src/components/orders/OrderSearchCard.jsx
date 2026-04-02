const ORDER_COLUMNS = [
  'CSOID',
  'po',
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
  po: ['po', 'order_number'],
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
  return String(order.CSOID ?? order.csoid ?? order.po ?? order.order_number ?? '');
}

export default function OrderSearchCard({
  csoidSearchValue,
  onCsoidSearchValueChange,
  filterType,
  onFilterTypeChange,
  filterDate,
  onFilterDateChange,
  filterStartDate,
  filterEndDate,
  onFilterStartDateChange,
  onFilterEndDateChange,
  onSearch,
  orders,
  loading,
  error,
  selectedOrder,
  onSelectOrder,
}) {
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
          <input
            type="text"
            value={csoidSearchValue}
            onChange={(event) => onCsoidSearchValueChange(event.target.value)}
            placeholder="Search by CSOID"
            aria-label="Search by CSOID"
          />
          <select
            value={filterType}
            onChange={(event) => onFilterTypeChange(event.target.value)}
            aria-label="Filter orders by day, week, or range"
          >
            <option value="">No date filter</option>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="range">Range</option>
          </select>
          {filterType === 'range' ? (
            <>
              <input
                type="date"
                value={filterStartDate}
                onChange={(event) => onFilterStartDateChange(event.target.value)}
                disabled={!filterType}
                aria-label="Order filter start date"
              />
              <input
                type="date"
                value={filterEndDate}
                onChange={(event) => onFilterEndDateChange(event.target.value)}
                disabled={!filterType}
                aria-label="Order filter end date"
              />
            </>
          ) : (
            <input
              type={filterType === 'week' ? 'week' : 'date'}
              value={filterDate}
              onChange={(event) => onFilterDateChange(event.target.value)}
              disabled={!filterType}
              aria-label="Order filter date"
            />
          )}
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
                  Search by CSOID, filter by day/week/range, or use both together.
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
