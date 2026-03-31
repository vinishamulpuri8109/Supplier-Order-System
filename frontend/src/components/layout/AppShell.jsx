export default function AppShell({ children }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Supplier Order Automation System</p>
        <h1>Order Management Dashboard</h1>
        <p className="subtext">
          Search customer orders, inspect order items, and submit supplier data from one screen.
        </p>
      </header>
      <main>{children}</main>
    </div>
  );
}
