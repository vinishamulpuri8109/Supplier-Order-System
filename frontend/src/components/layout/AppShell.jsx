export default function AppShell({ children, userEmail, onLogout }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Supplier Order Automation System</p>
        <h1>Order Management Dashboard</h1>
        <p className="subtext">
          Search customer orders, inspect order items, and submit supplier data from one screen.
        </p>
        {userEmail ? (
          <div className="user-bar">
            <span>{userEmail}</span>
            <button type="button" className="ghost" onClick={onLogout}>
              Logout
            </button>
          </div>
        ) : null}
      </header>
      <main>{children}</main>
    </div>
  );
}
