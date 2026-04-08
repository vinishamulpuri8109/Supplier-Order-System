export default function BackorderWidget({
  count = 0,
}) {
  return (
    <div className="backorder-widget">
      <div>
        <p className="backorder-widget-label">Backordered SOIDs</p>
        <h4 className="backorder-widget-count">{count}</h4>
      </div>
    </div>
  );
}
