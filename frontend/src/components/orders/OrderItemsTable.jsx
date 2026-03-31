const ITEM_COLUMNS = [
  'orderItemId',
  'Sku',
  'ProductName',
  'Quantity',
  'ProductPrice',
  'ItemTotal',
  'CSOID',
];

const ITEM_FIELD_MAP = {
  orderItemId: ['orderItemId', 'ordritmId', 'item_id'],
  Sku: ['Sku', 'sku'],
  ProductName: ['ProductName', 'product_name'],
  Quantity: ['Quantity', 'quantity'],
  ProductPrice: ['ProductPrice', 'product_price'],
  ItemTotal: ['ItemTotal', 'item_total'],
  CSOID: ['CSOID', 'csoid'],
};

function getItemFieldValue(item, column) {
  const candidates = ITEM_FIELD_MAP[column] || [column];
  for (const key of candidates) {
    if (key in item) {
      if (item[key] === null) {
        return 'null';
      }
      if (item[key] !== undefined) {
        return String(item[key]);
      }
    }
  }
  return '';
}

function getItemRowId(item) {
  return String(item.orderItemId ?? item.ordritmId ?? item.item_id ?? item.Sku ?? item.sku ?? '');
}

export default function OrderItemsTable({ items, loading, error, selectedItem, onSelectItem }) {
  const selectedId = getItemRowId(selectedItem || {});

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>CustomerOrderItems</h3>
      </div>

      {error ? <p className="status-text error-text">{error}</p> : null}
      {loading ? <p className="status-text">Loading order items...</p> : null}

      <div className="table-scroll compact-table">
        <table className="data-table">
          <thead>
            <tr>
              {ITEM_COLUMNS.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={ITEM_COLUMNS.length} className="empty-cell">
                  Select an order row to load item data.
                </td>
              </tr>
            ) : null}

            {items.map((item, index) => {
              const rowId = getItemRowId(item) || `item-${index}`;
              const isSelected = rowId === selectedId;

              return (
                <tr
                  key={rowId}
                  className={isSelected ? 'selected-row' : ''}
                  onClick={() => onSelectItem(item)}
                >
                  {ITEM_COLUMNS.map((column) => (
                    <td key={`${rowId}-${column}`}>{getItemFieldValue(item, column)}</td>
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
