import AppShell from '../components/layout/AppShell';
import OrderSearchCard from '../components/orders/OrderSearchCard';
import OrderItemsTable from '../components/orders/OrderItemsTable';
import SupplierOrderForm from '../components/supplier/SupplierOrderForm';
import { useEffect, useMemo, useState } from 'react';
import { WEBSITE_OPTIONS, WEBSITE_VENDOR_MAP } from '../constants/supplierOptions';
import { fetchOrderItems, saveSupplierData, searchOrders } from '../services/api';

const todayAsInputDate = () => new Date().toISOString().slice(0, 10);

const INITIAL_FORM_DATA = {
  vendorOrderDate: '',
  ourOrderNumber: '',
  vendorOrderNumber: '',
  vendorName: '',
  sku: '',
  unitPrice: '',
  quantity: '',
  subtotal: '',
  tax: '',
  shipping: '',
  discount: '',
  grandTotal: '',
  refund: '',
  components: '',
};

export default function DashboardPage() {
  const [csoidSearchValue, setCsoidSearchValue] = useState('');
  const [orderFilterType, setOrderFilterType] = useState('');
  const [orderFilterDate, setOrderFilterDate] = useState(todayAsInputDate());
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedWebsite, setSelectedWebsite] = useState('');
  const [selectedVendor, setSelectedVendor] = useState('');
  const [formData, setFormData] = useState(INITIAL_FORM_DATA);
  const [fieldErrors, setFieldErrors] = useState({});
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [itemsError, setItemsError] = useState('');
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const vendorOptions = useMemo(() => {
    return WEBSITE_VENDOR_MAP[selectedWebsite] || [];
  }, [selectedWebsite]);

  useEffect(() => {
    setSelectedVendor('');
  }, [selectedWebsite]);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      ourOrderNumber: String(selectedOrder?.CustOrderNumber ?? selectedOrder?.order_number ?? ''),
    }));
  }, [selectedOrder]);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      sku: String(selectedItem?.Sku ?? selectedItem?.sku ?? ''),
      quantity: String(selectedItem?.Quantity ?? selectedItem?.quantity ?? ''),
    }));
  }, [selectedItem]);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      vendorName: selectedVendor,
    }));
  }, [selectedVendor]);

  useEffect(() => {
    const subtotal = Number(formData.subtotal || 0);
    const tax = Number(formData.tax || 0);
    const shipping = Number(formData.shipping || 0);
    const discount = Number(formData.discount || 0);
    const total = subtotal + tax + shipping - discount;

    setFormData((prev) => ({
      ...prev,
      grandTotal: Number.isFinite(total) ? String(total) : '',
    }));
  }, [formData.subtotal, formData.tax, formData.shipping, formData.discount]);

  const loadOrderItems = async (order) => {
    const csoid = order?.CSOID ?? order?.csoid;
    if (!csoid) {
      setItems([]);
      setSelectedItem(null);
      return;
    }

    setItemsLoading(true);
    setItemsError('');
    setItems([]);

    try {
      const fetchedItems = await fetchOrderItems(csoid);
      setItems(fetchedItems);
      setSelectedItem(fetchedItems.length > 0 ? fetchedItems[0] : null);
    } catch (error) {
      setItemsError(error.message || 'Unable to load order items');
      setSelectedItem(null);
    } finally {
      setItemsLoading(false);
    }
  };

  const handleSearch = async () => {
    setOrdersLoading(true);
    setOrdersError('');
    setSuccessMessage('');

    try {
      const results = await searchOrders({
        csoid: csoidSearchValue,
        filterType: orderFilterType,
        filterDate: orderFilterDate,
      });
      setOrders(results);
      setSelectedItem(null);
      setItems([]);

      if (results.length > 0) {
        setSelectedOrder(results[0]);
        loadOrderItems(results[0]);
      } else {
        setSelectedOrder(null);
      }
    } catch (error) {
      setOrdersError(error.message || 'Unable to fetch orders');
      setOrders([]);
      setSelectedOrder(null);
      setSelectedItem(null);
      setItems([]);
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleSelectOrder = (order) => {
    setSelectedOrder(order);
    setSelectedItem(null);
    setSuccessMessage('');
    loadOrderItems(order);
  };

  const handleSelectItem = (item) => {
    setSelectedItem(item);
    setSuccessMessage('');
  };

  const handleFormChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    setFieldErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validateForm = () => {
    const errors = {};
    if (!formData.vendorOrderDate) {
      errors.vendorOrderDate = 'Vendor order date is required';
    }
    if (!formData.vendorName) {
      errors.vendorName = 'Vendor is required';
    }
    if (!formData.sku) {
      errors.sku = 'SKU is required';
    }
    if (!formData.quantity) {
      errors.quantity = 'Quantity is required';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveSupplierData = async () => {
    if (!selectedOrder) {
      setFormError('Select an order before saving supplier data');
      return;
    }

    if (!validateForm()) {
      setFormError('Please fix required fields before saving');
      return;
    }

    setSaving(true);
    setFormError('');
    setSuccessMessage('');

    const payload = {
      vendorOrderDate: formData.vendorOrderDate,
      ourOrderNumber: formData.ourOrderNumber,
      vendorOrderNumber: formData.vendorOrderNumber,
      vendorName: formData.vendorName,
      sku: formData.sku,
      unitPrice: Number(formData.unitPrice || 0),
      quantity: Number(formData.quantity || 0),
      subtotal: Number(formData.subtotal || 0),
      tax: Number(formData.tax || 0),
      shipping: Number(formData.shipping || 0),
      discount: Number(formData.discount || 0),
      grandTotal: Number(formData.grandTotal || 0),
      refund: Number(formData.refund || 0),
      components: formData.components,
      website: selectedWebsite,
    };

    try {
      await saveSupplierData(payload, { selectedOrder, selectedItem });
      setSuccessMessage('Supplier data saved successfully');
    } catch (error) {
      setFormError(error.message || 'Unable to save supplier data');
    } finally {
      setSaving(false);
    }
  };

  const handleClearForm = () => {
    setSelectedWebsite('');
    setSelectedVendor('');
    setFormData((prev) => ({
      ...INITIAL_FORM_DATA,
      ourOrderNumber: prev.ourOrderNumber,
      sku: prev.sku,
      quantity: prev.quantity,
    }));
    setFieldErrors({});
    setFormError('');
    setSuccessMessage('');
  };

  return (
    <AppShell>
      <div className="dashboard-layout">
        <section className="dashboard-half order-data-half">
          <h2 className="section-heading">Order Data</h2>
          <OrderSearchCard
            csoidSearchValue={csoidSearchValue}
            onCsoidSearchValueChange={setCsoidSearchValue}
            filterType={orderFilterType}
            onFilterTypeChange={setOrderFilterType}
            filterDate={orderFilterDate}
            onFilterDateChange={setOrderFilterDate}
            onSearch={handleSearch}
            orders={orders}
            loading={ordersLoading}
            error={ordersError}
            selectedOrder={selectedOrder}
            onSelectOrder={handleSelectOrder}
          />
          <OrderItemsTable
            items={items}
            loading={itemsLoading}
            error={itemsError}
            selectedItem={selectedItem}
            onSelectItem={handleSelectItem}
          />
        </section>

        <section className="dashboard-half supplier-entry-half">
          <h2 className="section-heading">Supplier Entry</h2>
          <SupplierOrderForm
            selectedOrder={selectedOrder}
            selectedWebsite={selectedWebsite}
            selectedVendor={selectedVendor}
            websiteOptions={WEBSITE_OPTIONS}
            vendorOptions={vendorOptions}
            onWebsiteChange={setSelectedWebsite}
            onVendorChange={setSelectedVendor}
            formData={formData}
            fieldErrors={fieldErrors}
            formError={formError}
            successMessage={successMessage}
            saving={saving}
            onFormChange={handleFormChange}
            onSave={handleSaveSupplierData}
            onClear={handleClearForm}
          />
        </section>
      </div>
    </AppShell>
  );
}
