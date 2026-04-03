import AppShell from '../components/layout/AppShell';
import OrderSearchCard from '../components/orders/OrderSearchCard';
import OrderItemsTable from '../components/orders/OrderItemsTable';
import SupplierOrderForm from '../components/supplier/SupplierOrderForm';
import { useEffect, useMemo, useState } from 'react';
import { WEBSITE_OPTIONS, WEBSITE_VENDOR_MAP } from '../constants/supplierOptions';
import {
  fetchNextOrderNumber,
  fetchOrderItems,
  saveSupplierData,
  searchOrders,
} from '../services/api';

const todayAsInputDate = () => new Date().toISOString().slice(0, 10);

const toIsoWeekString = (date) => {
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((utcDate - yearStart) / 86400000 + 1) / 7);
  const weekStr = String(weekNo).padStart(2, '0');
  return `${utcDate.getUTCFullYear()}-W${weekStr}`;
};

const weekInputToDate = (weekInput) => {
  const match = /^([0-9]{4})-W([0-9]{2})$/.exec(weekInput);
  if (!match) {
    return '';
  }
  const year = Number(match[1]);
  const week = Number(match[2]);
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const weekStart = new Date(firstThursday);
  weekStart.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() || 7) - 1));
  weekStart.setUTCDate(weekStart.getUTCDate() + (week - 1) * 7);
  return weekStart.toISOString().slice(0, 10);
};

const isValidSoid = (value) => {
  return /^\d{5,}$/.test(value);
};

const MONEY_INPUT_REGEX = /^\d*(?:\.\d{0,2})?$/;
const MONEY_FIELDS = new Set(['unitPrice', 'tax', 'shipping', 'discount', 'refund']);

const roundToTwo = (value) => Number(Number(value || 0).toFixed(2));

const formatMoneyValue = (value) => {
  if (value === '' || value === null || value === undefined) {
    return '';
  }

  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    return '';
  }

  return Number(parsedValue.toFixed(2)).toFixed(2);
};

const sanitizeMoneyInput = (nextValue, previousValue) => {
  if (nextValue === '') {
    return '';
  }

  if (!MONEY_INPUT_REGEX.test(nextValue)) {
    return previousValue;
  }

  return nextValue;
};

const toMoneyNumber = (value) => roundToTwo(value);

const INITIAL_FORM_DATA = {
  vendorOrderDate: '',
  soid: '',
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
  comments: '',
};

export default function DashboardPage({ userEmail, onLogout }) {
  const [csoidSearchValue, setCsoidSearchValue] = useState('');
  const [orderFilterType, setOrderFilterType] = useState('');
  const [orderFilterDate, setOrderFilterDate] = useState(todayAsInputDate());
  const [orderFilterStartDate, setOrderFilterStartDate] = useState(todayAsInputDate());
  const [orderFilterEndDate, setOrderFilterEndDate] = useState(todayAsInputDate());
  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [selectedWebsite, setSelectedWebsite] = useState('');
  const [selectedVendor, setSelectedVendor] = useState('');
  const [customVendorName, setCustomVendorName] = useState('');
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
    const baseOptions = WEBSITE_VENDOR_MAP[selectedWebsite] || [];
    if (baseOptions.includes('Other')) {
      return baseOptions;
    }
    return [...baseOptions, 'Other'];
  }, [selectedWebsite]);

  useEffect(() => {
    setSelectedVendor('');
    setCustomVendorName('');
  }, [selectedWebsite]);

  useEffect(() => {
    if (!orderFilterType) {
      return;
    }
    if (orderFilterType === 'week') {
      if (!orderFilterDate || !orderFilterDate.includes('W')) {
        const anchorDate = orderFilterDate ? new Date(orderFilterDate) : new Date();
        setOrderFilterDate(toIsoWeekString(anchorDate));
      }
      return;
    }
    if (orderFilterType === 'range') {
      if (!orderFilterStartDate) {
        setOrderFilterStartDate(todayAsInputDate());
      }
      if (!orderFilterEndDate) {
        setOrderFilterEndDate(todayAsInputDate());
      }
      return;
    }
    if (orderFilterDate.includes('W')) {
      setOrderFilterDate(todayAsInputDate());
    }
  }, [orderFilterType, orderFilterDate, orderFilterStartDate, orderFilterEndDate]);

  useEffect(() => {
    let isActive = true;
    const orderId = selectedOrder?.CSOID ?? selectedOrder?.csoid ?? null;

    if (!orderId || !selectedItem) {
      setFormData((prev) => ({
        ...prev,
        soid: '',
      }));
      return () => {
        isActive = false;
      };
    }

    setFormData((prev) => ({
      ...prev,
      soid: '',
    }));

    fetchNextOrderNumber()
      .then((orderNumber) => {
        if (!isActive) {
          return;
        }
        setFormData((prev) => ({
          ...prev,
          soid: orderNumber,
        }));
      })
      .catch(() => {
        if (!isActive) {
          return;
        }
        setFormError('Unable to generate order number');
      });

    return () => {
      isActive = false;
    };
  }, [selectedOrder, selectedItem]);

  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      sku: String(selectedItem?.Sku ?? selectedItem?.sku ?? ''),
      quantity: String(selectedItem?.Quantity ?? selectedItem?.quantity ?? ''),
    }));
  }, [selectedItem]);

  useEffect(() => {
    const resolvedVendor = selectedVendor === 'Other' ? customVendorName : selectedVendor;
    setFormData((prev) => ({
      ...prev,
      vendorName: resolvedVendor,
    }));
  }, [selectedVendor, customVendorName]);

  useEffect(() => {
    const quantity = Number(formData.quantity || 0);
    const unitPrice = Number(formData.unitPrice || 0);

    if (!quantity || !unitPrice) {
      setFormData((prev) => ({
        ...prev,
        subtotal: '',
      }));
      return;
    }

    const calculatedSubtotal = roundToTwo(quantity * unitPrice);

    setFormData((prev) => ({
      ...prev,
      subtotal: calculatedSubtotal.toFixed(2),
    }));
  }, [formData.quantity, formData.unitPrice]);

  useEffect(() => {
    if (!formData.subtotal) {
      setFormData((prev) => ({
        ...prev,
        grandTotal: '',
      }));
      return;
    }

    const subtotal = Number(formData.subtotal || 0);
    const tax = Number(formData.tax || 0);
    const shipping = Number(formData.shipping || 0);
    const discount = Number(formData.discount || 0);
    const total = roundToTwo(subtotal + tax + shipping - discount);

    setFormData((prev) => ({
      ...prev,
      grandTotal: total.toFixed(2),
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
      const resolvedFilterDate =
        orderFilterType === 'week'
          ? weekInputToDate(orderFilterDate) || todayAsInputDate()
          : orderFilterDate;
      const results = await searchOrders({
        csoid: csoidSearchValue,
        filterType: orderFilterType,
        filterDate: resolvedFilterDate,
        filterStartDate: orderFilterStartDate,
        filterEndDate: orderFilterEndDate,
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
      const rawMessage = error?.message || 'Unable to fetch orders';
      const searchingByCsoid = Boolean((csoidSearchValue || '').trim());
      const isAuthTokenError = /invalid authentication token|not authenticated|unauthorized/i.test(rawMessage);

      if (searchingByCsoid && isAuthTokenError) {
        setOrdersError('CSOID does not exist');
      } else {
        setOrdersError(rawMessage);
      }
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
    const clearFieldError = () => {
      setFieldErrors((prev) => {
        if (!prev[field]) {
          return prev;
        }
        const next = { ...prev };
        delete next[field];
        return next;
      });
    };

    if (field === 'quantity') {
      const cleaned = value.replace(/[^0-9]/g, '');
      setFormData((prev) => ({
        ...prev,
        [field]: cleaned,
      }));
      clearFieldError();
      return;
    }

    if (MONEY_FIELDS.has(field)) {
      setFormData((prev) => ({
        ...prev,
        [field]: sanitizeMoneyInput(value, prev[field]),
      }));
      clearFieldError();
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
    clearFieldError();
  };

  const validateForm = () => {
    const errors = {};
    const today = todayAsInputDate();

    if (!formData.soid) {
      errors.soid = 'SOID is required';
    } else if (!isValidSoid(formData.soid)) {
      errors.soid = 'SOID must be a positive integer';
    }

    const csoidValue = Number(selectedOrder?.CSOID ?? selectedOrder?.csoid ?? 0);
    if (!Number.isInteger(csoidValue) || csoidValue <= 0) {
      errors.csoid = 'CSOID is required';
    }

    const poValue = String(
      selectedOrder?.CustOrderNumber ?? selectedOrder?.po ?? selectedOrder?.order_number ?? '',
    ).trim();
    if (!poValue) {
      errors.po = 'PO is required';
    }

    if (!formData.sku) {
      errors.sku = 'SKU is required';
    }

    if (!selectedWebsite) {
      errors.website = 'Website is required';
    }

    if (!formData.vendorName) {
      errors.vendorName = 'Vendor is required';
    }

    if (!formData.vendorOrderDate) {
      errors.vendorOrderDate = 'Vendor order date is required';
    } else if (formData.vendorOrderDate > today) {
      errors.vendorOrderDate = 'Vendor order date cannot be in the future';
    }

    if (!formData.vendorOrderNumber) {
      errors.vendorOrderNumber = 'Vendor order number is required';
    }

    const unitPrice = toMoneyNumber(formData.unitPrice);
    const quantity = Number(formData.quantity || 0);
    const subtotal = toMoneyNumber(formData.subtotal);
    const tax = toMoneyNumber(formData.tax);
    const shipping = toMoneyNumber(formData.shipping);
    const discount = toMoneyNumber(formData.discount);
    const grandTotal = toMoneyNumber(formData.grandTotal);
    const refund = toMoneyNumber(formData.refund);

    if (unitPrice <= 0) {
      errors.unitPrice = 'Unit price must be greater than 0';
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      errors.quantity = 'Quantity must be an integer greater than 0';
    }

    const expectedSubtotal = roundToTwo(unitPrice * quantity);
    if (subtotal < 0 || subtotal !== expectedSubtotal) {
      errors.subtotal = 'Subtotal must equal unit price * quantity';
    }

    if (tax < 0) {
      errors.tax = 'Tax must be >= 0';
    }

    if (shipping < 0) {
      errors.shipping = 'Shipping must be >= 0';
    }

    if (discount < 0 || discount > subtotal) {
      errors.discount = 'Discount must be >= 0 and <= subtotal';
    }

    const expectedGrandTotal = roundToTwo(subtotal + tax + shipping - discount);
    if (grandTotal < 0 || grandTotal !== expectedGrandTotal) {
      errors.grandTotal = 'Grand total must equal subtotal + tax + shipping - discount';
    }

    if (refund < 0) {
      errors.refund = 'Refund must be >= 0';
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
      po: String(selectedOrder?.CustOrderNumber ?? selectedOrder?.po ?? selectedOrder?.order_number ?? '').trim(),
      vendorOrderDate: formData.vendorOrderDate,
      soid: formData.soid,
      vendorOrderNumber: formData.vendorOrderNumber.trim(),
      vendorName: formData.vendorName,
      sku: formData.sku,
      unitPrice: toMoneyNumber(formData.unitPrice),
      quantity: Number(formData.quantity || 0),
      subtotal: toMoneyNumber(formData.subtotal),
      tax: toMoneyNumber(formData.tax),
      shipping: toMoneyNumber(formData.shipping),
      discount: toMoneyNumber(formData.discount),
      grandTotal: toMoneyNumber(formData.grandTotal),
      refund: toMoneyNumber(formData.refund),
      comments: formData.comments.trim(),
      website: selectedWebsite,
    };

    try {
      const response = await saveSupplierData(payload, { selectedOrder, selectedItem });
      const savedSoid = response?.supplierOrder?.soid ? String(response.supplierOrder.soid) : formData.soid;
      setFormData((prev) => ({
        ...prev,
        soid: savedSoid,
      }));
      setSuccessMessage('Supplier data saved successfully');

      fetchNextOrderNumber()
        .then((nextOrderNumber) => {
          setFormData((prev) => ({
            ...prev,
            soid: nextOrderNumber,
          }));
        })
        .catch(() => {});
    } catch (error) {
      setFormError(error.message || 'Unable to save supplier data');
    } finally {
      setSaving(false);
    }
  };

  const handleClearForm = () => {
    setSelectedWebsite('');
    setSelectedVendor('');
    setCustomVendorName('');
    setFormData((prev) => ({
      ...INITIAL_FORM_DATA,
      soid: prev.soid,
      sku: prev.sku,
      quantity: prev.quantity,
    }));
    setFieldErrors({});
    setFormError('');
    setSuccessMessage('');
  };

  return (
    <AppShell userEmail={userEmail} onLogout={onLogout}>
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
            filterStartDate={orderFilterStartDate}
            filterEndDate={orderFilterEndDate}
            onFilterStartDateChange={setOrderFilterStartDate}
            onFilterEndDateChange={setOrderFilterEndDate}
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
            customVendorName={customVendorName}
            websiteOptions={WEBSITE_OPTIONS}
            vendorOptions={vendorOptions}
            onWebsiteChange={setSelectedWebsite}
            onVendorChange={setSelectedVendor}
            onCustomVendorNameChange={setCustomVendorName}
            formData={formData}
            fieldErrors={fieldErrors}
            formError={formError}
            successMessage={successMessage}
            saving={saving}
            onFormChange={handleFormChange}
            onFormBlur={(field, value) => {
              if (!MONEY_FIELDS.has(field) && field !== 'quantity') {
                return;
              }

              if (field === 'quantity') {
                const cleaned = value.replace(/[^0-9]/g, '');
                setFormData((prev) => ({
                  ...prev,
                  quantity: cleaned,
                }));
                return;
              }

              setFormData((prev) => ({
                ...prev,
                [field]: formatMoneyValue(value),
              }));
            }}
            onSave={handleSaveSupplierData}
            onClear={handleClearForm}
          />
        </section>
      </div>
    </AppShell>
  );
}
