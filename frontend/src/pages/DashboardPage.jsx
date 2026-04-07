import AppShell from '../components/layout/AppShell';
import OrderSearchCard from '../components/orders/OrderSearchCard';
import OrderItemsTable from '../components/orders/OrderItemsTable';
import SupplierOrderCard from '../components/supplier/SupplierOrderCard';
import { useMemo, useState } from 'react';
import { WEBSITE_OPTIONS, WEBSITE_VENDOR_MAP } from '../constants/supplierOptions';
import {
  createSupplierOrders,
  fetchOrderItems,
  fetchSupplierOrders,
  searchOrders,
  updateSupplierOrder,
} from '../services/api';

const todayAsInputDate = () => new Date().toISOString().slice(0, 10);
const MONEY_INPUT_REGEX = /^\d*(?:\.\d{0,2})?$/;
const ITEM_STATUSES = ['confirmed', 'backordered', 'cancelled', 'returned'];

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

const roundToTwo = (value) => Number(Number(value || 0).toFixed(2));
const formatMoney = (value) => Number(Number(value || 0).toFixed(2)).toFixed(2);

function normalizeMoneyInput(nextValue, previousValue) {
  if (nextValue === '') {
    return '';
  }
  if (!MONEY_INPUT_REGEX.test(nextValue)) {
    return previousValue;
  }
  return nextValue;
}

function getItemKey(item) {
  return String(item.Sku ?? item.sku ?? item.orderItemId ?? item.id ?? '');
}

function getOrderKey(order) {
  return String(order?.soid ?? order?.draft_id ?? order?.vendor_name ?? '');
}

function resolveItemField(item, candidates) {
  for (const key of candidates) {
    if (item[key] !== undefined && item[key] !== null) {
      return item[key];
    }
  }
  return '';
}

function deriveOrderStatusFromItems(items) {
  const statuses = new Set((items || []).map((item) => String(item.status || item.availability_status || 'confirmed').toLowerCase()));
  if (statuses.has('backordered')) return 'backordered';
  if (statuses.has('cancelled')) return 'cancelled';
  if (statuses.has('returned')) return 'returned';
  return 'confirmed';
}

function buildLocalSupplierOrders(csoid, assignments) {
  const grouped = {};

  for (const assignment of Object.values(assignments)) {
    const vendor = String(assignment.vendor_name || 'None').trim() || 'None';
    const itemStatus = vendor === 'None' ? 'backordered' : 'confirmed';
    if (!grouped[vendor]) {
      grouped[vendor] = [];
    }

    const quantity = Number(assignment.quantity || 0);
    const unitPrice = vendor === 'None' ? 0 : roundToTwo(assignment.unit_price || 0);
    const subtotal = roundToTwo(quantity * unitPrice);

    grouped[vendor].push({
      id: `${vendor}-${assignment.sku}`,
      soid: 0,
      csoid,
      cust_order_number: assignment.cust_order_number || null,
      status: itemStatus,
      sku: String(assignment.sku || '').trim().toUpperCase(),
      product_name: String(assignment.product_name || '').trim(),
      quantity,
      unit_price: unitPrice,
      subtotal,
    });
  }

  const vendors = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  return vendors.map((vendor, index) => {
    const draftId = `draft-${index + 1}`;
    const items = grouped[vendor].map((item) => ({ ...item, draft_id: draftId }));
    const subtotal = roundToTwo(items.reduce((acc, item) => acc + Number(item.subtotal || 0), 0));
    const nonConfirmedItem = items.find((item) => item.status !== 'confirmed') || null;
    const status = nonConfirmedItem ? nonConfirmedItem.status : 'confirmed';
    return {
      soid: null,
      draft_id: draftId,
      csoid,
      vendor_name: vendor,
      status,
      subtotal,
      tax_total: 0,
      shipping_total: 0,
      discount_total: 0,
      refund_total: 0,
      grand_total: subtotal,
      vendor_website_order_date: null,
      vendor_website_order_number: '',
      comments: '',
      items,
      is_local_draft: true,
    };
  });
}

export default function DashboardPage({ userEmail, onLogout }) {
  const [csoidSearchValue, setCsoidSearchValue] = useState('');
  const [orderFilterType, setOrderFilterType] = useState('');
  const [orderFilterDate, setOrderFilterDate] = useState(todayAsInputDate());
  const [orderFilterStartDate, setOrderFilterStartDate] = useState(todayAsInputDate());
  const [orderFilterEndDate, setOrderFilterEndDate] = useState(todayAsInputDate());

  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedWebsite, setSelectedWebsite] = useState('');

  const [ordersLoading, setOrdersLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [supplierLoading, setSupplierLoading] = useState(false);
  const [savingSupplier, setSavingSupplier] = useState(false);

  const [ordersError, setOrdersError] = useState('');
  const [itemsError, setItemsError] = useState('');
  const [supplierError, setSupplierError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [skuAssignments, setSkuAssignments] = useState({});
  const [assignmentErrors, setAssignmentErrors] = useState({});
  const [supplierOrders, setSupplierOrders] = useState([]);
  const [supplierFinancialDrafts, setSupplierFinancialDrafts] = useState({});
  const [editingOrderKeys, setEditingOrderKeys] = useState({});
  const [savingOrderKeys, setSavingOrderKeys] = useState({});
  const vendorOptions = useMemo(() => {
    const fromWebsite = WEBSITE_VENDOR_MAP[selectedWebsite] || [];
    const fromAssignments = Object.values(skuAssignments)
      .map((entry) => (entry?.vendor_name || '').trim())
      .filter((value) => Boolean(value) && value !== 'None');
    const fromOrders = supplierOrders.map((order) => order.vendor_name).filter(Boolean);
    return ['None', ...new Set([...fromWebsite, ...fromAssignments, ...fromOrders])];
  }, [selectedWebsite, skuAssignments, supplierOrders]);

  const initializeAssignments = (fetchedItems) => {
    const nextAssignments = {};
    for (const item of fetchedItems) {
      const key = getItemKey(item);
      nextAssignments[key] = {
        sku: String(resolveItemField(item, ['Sku', 'sku'])).toUpperCase(),
        product_name: String(resolveItemField(item, ['ProductName', 'product_name'])) || String(resolveItemField(item, ['Sku', 'sku'])),
        quantity: Number(resolveItemField(item, ['Quantity', 'quantity']) || 0),
        cust_order_number: String(selectedOrder?.CustOrderNumber ?? selectedOrder?.cust_order_number ?? '').trim(),
        status: 'backordered',
        vendor_name: 'None',
        unit_price: '0.00',
      };
    }
    setSkuAssignments(nextAssignments);
    setAssignmentErrors({});
  };

  const loadSupplierOrders = async (csoid) => {
    if (!csoid) {
      setSupplierOrders([]);
      return;
    }

    setSupplierLoading(true);
    setSupplierError('');
    try {
      const data = await fetchSupplierOrders(csoid);
      setSupplierOrders(data);
      setEditingOrderKeys({});
      setSupplierFinancialDrafts((prev) => {
        const next = {};
        for (const order of data) {
          const orderKey = getOrderKey(order);
          const current = prev[orderKey] || {};
          next[orderKey] = {
            vendor_name: current.vendor_name ?? (order.vendor_name || 'None'),
            vendor_website_order_date: current.vendor_website_order_date ?? (order.vendor_website_order_date || ''),
            vendor_website_order_number: current.vendor_website_order_number ?? (order.vendor_website_order_number || ''),
            status: current.status ?? (order.status || 'confirmed'),
            tax_total: current.tax_total ?? formatMoney(order.tax_total),
            shipping_total: current.shipping_total ?? formatMoney(order.shipping_total),
            discount_total: current.discount_total ?? formatMoney(order.discount_total),
            refund_total: current.refund_total ?? formatMoney(order.refund_total),
            comments: current.comments ?? (order.comments || ''),
          };
        }
        return next;
      });
    } catch (error) {
      setSupplierOrders([]);
      setSupplierFinancialDrafts({});
      setSupplierError(error.message || 'Unable to load supplier orders');
    } finally {
      setSupplierLoading(false);
    }
  };

  const loadOrderItems = async (order) => {
    const csoid = Number(order?.CSOID ?? order?.csoid ?? 0);
    if (!csoid) {
      setItems([]);
      setSkuAssignments({});
      setSupplierOrders([]);
      setSupplierFinancialDrafts({});
      return;
    }

    setItemsLoading(true);
    setItemsError('');
    setSupplierError('');
    setSuccessMessage('');

    try {
      const fetchedItems = await fetchOrderItems(csoid);
      setItems(fetchedItems);
      initializeAssignments(fetchedItems);
      await loadSupplierOrders(csoid);
    } catch (error) {
      setItems([]);
      setSkuAssignments({});
      setItemsError(error.message || 'Unable to load order items');
      setSupplierOrders([]);
      setSupplierFinancialDrafts({});
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
        orderRef: csoidSearchValue,
        filterType: orderFilterType,
        filterDate: resolvedFilterDate,
        filterStartDate: orderFilterStartDate,
        filterEndDate: orderFilterEndDate,
      });

      setOrders(results);
      setItems([]);
      setSupplierOrders([]);
      setSupplierFinancialDrafts({});

      if (results.length > 0) {
        setSelectedOrder(results[0]);
        await loadOrderItems(results[0]);
      } else {
        setSelectedOrder(null);
        setSkuAssignments({});
      }
    } catch (error) {
      setOrdersError(error?.message || 'Unable to fetch orders');
      setOrders([]);
      setSelectedOrder(null);
      setItems([]);
      setSkuAssignments({});
      setSupplierOrders([]);
      setSupplierFinancialDrafts({});
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleSelectOrder = (order) => {
    setSelectedOrder(order);
    loadOrderItems(order);
  };

  const handleAssignmentChange = (skuKey, field, value) => {
    setSkuAssignments((prev) => {
      const current = prev[skuKey] || {};
      const nextValue = field === 'unit_price' ? normalizeMoneyInput(value, current[field]) : value;
      const nextRow = {
        ...current,
        [field]: nextValue,
      };

      const nextVendor = String(nextRow.vendor_name || 'None').trim() || 'None';
      nextRow.status = nextVendor.toLowerCase() === 'none' ? 'backordered' : 'confirmed';
      if (nextRow.status !== 'confirmed') {
        nextRow.vendor_name = 'None';
        nextRow.unit_price = '0.00';
      }
      if (field === 'vendor_name' && String(value || '').trim().toLowerCase() !== 'none') {
        nextRow.vendor_name = value;
        nextRow.unit_price = current.unit_price === '0.00' ? '' : nextRow.unit_price;
      }

      return {
        ...prev,
        [skuKey]: nextRow,
      };
    });

    setAssignmentErrors((prev) => {
      if (!prev[skuKey]) {
        return prev;
      }
      const next = { ...prev };
      delete next[skuKey];
      return next;
    });
  };

  const validateAssignments = () => {
    const errors = {};

    for (const [key, assignment] of Object.entries(skuAssignments)) {
      const rowErrors = [];
      const unitPrice = Number(assignment.unit_price || 0);
      const quantity = Number(assignment.quantity || 0);
      const itemStatus = String(assignment.vendor_name || 'None').trim().toLowerCase() === 'none' ? 'backordered' : 'confirmed';

      if (!ITEM_STATUSES.includes(itemStatus)) {
        rowErrors.push('Status is invalid');
      }

      if (itemStatus === 'confirmed' && !(assignment.vendor_name || '').trim()) {
        rowErrors.push('Vendor is required');
      }
      if (!MONEY_INPUT_REGEX.test(String(assignment.unit_price || ''))) {
        rowErrors.push('Unit price can have at most 2 decimals');
      } else if (itemStatus === 'confirmed' && (!Number.isFinite(unitPrice) || unitPrice <= 0)) {
        rowErrors.push('Unit price must be greater than 0');
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        rowErrors.push('Quantity must be greater than 0');
      }

      if (rowErrors.length > 0) {
        errors[key] = rowErrors.join(' | ');
      }
    }

    setAssignmentErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const generateSupplierOrders = async () => {
    const csoid = Number(selectedOrder?.CSOID ?? selectedOrder?.csoid ?? 0);
    if (!csoid || items.length === 0) {
      setSupplierError('Select an order with items first');
      return;
    }

    if (!validateAssignments()) {
      setSupplierError('Fix SKU assignment errors before generating supplier orders');
      return;
    }

    setSavingSupplier(true);
    setSupplierError('');
    setSuccessMessage('');

    try {
      const generatedOrders = buildLocalSupplierOrders(csoid, skuAssignments);
      const custOrderNumber = String(selectedOrder?.CustOrderNumber ?? selectedOrder?.cust_order_number ?? '').trim();
      const createPayload = {
        csoid,
        cust_order_number: custOrderNumber || null,
        items: generatedOrders.flatMap((orderPayload) =>
          (orderPayload.items || []).map((item) => ({
            cust_order_number: custOrderNumber || null,
            sku: String(item.sku || '').trim().toUpperCase(),
            status: String(item.status || 'confirmed').toLowerCase(),
            product_name: String(item.product_name || '').trim(),
            quantity: Number(item.quantity || 0),
            vendor_name: String(orderPayload.vendor_name || 'None').trim() || 'None',
            unit_price: roundToTwo(item.unit_price),
            vendor_website_order_date: orderPayload.vendor_website_order_date || null,
            vendor_website_order_number: (orderPayload.vendor_website_order_number || '').trim(),
          }))
        ),
      };

      await createSupplierOrders(createPayload);
      const persistedOrders = await fetchSupplierOrders(csoid);
      setSupplierOrders(persistedOrders);
      setSupplierFinancialDrafts(
        Object.fromEntries(
          persistedOrders.map((order) => [
            getOrderKey(order),
            {
              vendor_website_order_date: order.vendor_website_order_date || '',
              vendor_website_order_number: order.vendor_website_order_number || '',
              status: order.status || 'confirmed',
              tax_total: formatMoney(order.tax_total),
              shipping_total: formatMoney(order.shipping_total),
              discount_total: formatMoney(order.discount_total),
              refund_total: formatMoney(order.refund_total),
              comments: order.comments || '',
            },
          ])
        )
      );
      setSuccessMessage('Supplier orders created. Review the saved SOIDs and fill in the fields below.');
    } catch (error) {
      setSupplierError(error.message || 'Unable to generate supplier orders');
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleFinancialDraftChange = (soid, field, value) => {
    if (field === 'status' || field === 'vendor_name') {
      const normalized = String(value || 'confirmed').toLowerCase();
      setSupplierOrders((prev) => prev.map((order) => {
        if (getOrderKey(order) !== String(soid)) {
          return order;
        }
        const nextStatus = field === 'vendor_name'
          ? (normalized === 'none' ? 'backordered' : (order.status === 'backordered' ? 'confirmed' : order.status))
          : normalized;
        return {
          ...order,
          status: nextStatus,
          vendor_name:
            field === 'status' && normalized === 'backordered'
              ? 'None'
              : (field === 'vendor_name' ? (value || 'None') : order.vendor_name),
          vendor_website_order_date:
            field === 'status' && normalized === 'backordered'
              ? null
              : order.vendor_website_order_date,
          vendor_website_order_number:
            field === 'status' && normalized === 'backordered'
              ? ''
              : order.vendor_website_order_number,
        };
      }));
    }
    setSupplierFinancialDrafts((prev) => {
      const orderKey = String(soid);
      const current = prev[orderKey] || {
        vendor_name: 'None',
        vendor_website_order_date: '',
        vendor_website_order_number: '',
        status: 'confirmed',
        tax_total: '0.00',
        shipping_total: '0.00',
        discount_total: '0.00',
        refund_total: '0.00',
        comments: '',
      };

      if (field === 'comments' || field === 'vendor_website_order_date' || field === 'vendor_website_order_number' || field === 'status' || field === 'vendor_name') {
        const nextValue = field === 'vendor_name' ? (value || 'None') : value;
        const normalizedStatus = field === 'status'
          ? String(nextValue || 'confirmed').toLowerCase()
          : String(current.status || 'confirmed').toLowerCase();
        return {
          ...prev,
          [orderKey]: {
            ...current,
            [field]: nextValue,
            ...(field === 'vendor_name' && String(nextValue).toLowerCase() === 'none' ? { status: 'backordered' } : {}),
            ...(field === 'vendor_name' && String(nextValue).toLowerCase() !== 'none' && current.status === 'backordered' ? { status: 'confirmed' } : {}),
            ...(field === 'status' && normalizedStatus === 'backordered'
              ? {
                  vendor_name: 'None',
                  vendor_website_order_date: '',
                  vendor_website_order_number: '',
                }
              : {}),
          },
        };
      }

      return {
        ...prev,
        [orderKey]: {
          ...current,
          [field]: normalizeMoneyInput(value, current[field]),
        },
      };
    });
  };

  const handleOrderItemChange = (soid, itemId, field, value) => {
    setSupplierOrders((prev) => prev.map((order) => {
      if (getOrderKey(order) !== String(soid)) {
        return order;
      }
      const nextItems = (order.items || []).map((item) => {
        if (item.id !== itemId) {
          return item;
        }
        const nextItem = { ...item };
        if (field === 'quantity') {
          const parsed = Number(value);
          nextItem.quantity = Number.isFinite(parsed) && parsed > 0 ? parsed : item.quantity;
        } else if (field === 'unit_price') {
          nextItem.unit_price = normalizeMoneyInput(String(value), String(item.unit_price));
        }
        nextItem.status = String(order.status || 'confirmed').toLowerCase();
        nextItem.availability_status = nextItem.status;
        if (nextItem.status !== 'confirmed') {
          nextItem.unit_price = '0.00';
        }
        nextItem.subtotal = roundToTwo(Number(nextItem.quantity || 0) * Number(nextItem.unit_price || 0));
        return nextItem;
      });
      const nextSubtotal = roundToTwo(nextItems.reduce((acc, item) => acc + Number(item.subtotal || 0), 0));
      return {
        ...order,
        items: nextItems,
        subtotal: nextSubtotal,
        status: deriveOrderStatusFromItems(nextItems),
      };
    }));
  };

  const getGrandTotalPreview = (order) => {
    const draft = supplierFinancialDrafts[getOrderKey(order)] || {};
    const subtotal = roundToTwo(order.subtotal || 0);
    const tax = roundToTwo(draft.tax_total || 0);
    const shipping = roundToTwo(draft.shipping_total || 0);
    const discount = roundToTwo(draft.discount_total || 0);
    const refund = roundToTwo(draft.refund_total || 0);
    return roundToTwo(subtotal + tax + shipping - discount - refund);
  };

  const handleToggleOrderEdit = (orderKey) => {
    setEditingOrderKeys((prev) => ({
      ...prev,
      [orderKey]: !prev[orderKey],
    }));
  };

  const validateSingleSupplierOrder = (order) => {
    const draft = supplierFinancialDrafts[getOrderKey(order)] || {};
    const normalizedVendor = String(draft.vendor_name || order.vendor_name || '').trim() || 'None';
    const normalizedStatus = String(draft.status || order.status || 'confirmed').toLowerCase();

    if (normalizedStatus === 'confirmed' && normalizedVendor.toLowerCase() === 'none') {
      return `SOID ${order.soid}: vendor is required when status is confirmed`;
    }
    if (normalizedStatus === 'backordered' && normalizedVendor.toLowerCase() !== 'none') {
      return `SOID ${order.soid}: vendor must be None when status is backordered`;
    }

    const moneyFields = ['tax_total', 'shipping_total', 'discount_total', 'refund_total'];
    for (const field of moneyFields) {
      const raw = String(draft[field] ?? '0.00');
      if (!MONEY_INPUT_REGEX.test(raw)) {
        return `SOID ${order.soid}: ${field} must have at most 2 decimals`;
      }
      if (Number(raw || 0) < 0) {
        return `SOID ${order.soid}: ${field} must be >= 0`;
      }
    }

    if (Number(draft.discount_total || 0) > Number(order.subtotal || 0)) {
      return `SOID ${order.soid}: discount cannot exceed subtotal`;
    }

    return '';
  };

  const buildOrderPayload = (order) => {
    const draft = supplierFinancialDrafts[order.soid] || {};
    const normalizedVendor = String(draft.vendor_name || order.vendor_name || 'None').trim() || 'None';
    const normalizedStatus = String(draft.status || order.status || 'confirmed').toLowerCase();
    return {
      soid: order.soid,
      csoid: order.csoid,
      cust_order_number: String(selectedOrder?.CustOrderNumber ?? selectedOrder?.cust_order_number ?? '').trim() || null,
      vendor_name: normalizedVendor,
      status: normalizedStatus,
      vendor_website_order_date: draft.vendor_website_order_date || null,
      vendor_website_order_number: (draft.vendor_website_order_number || '').trim(),
      comments: (draft.comments || '').trim(),
      subtotal: roundToTwo(order.subtotal || 0),
      tax_total: roundToTwo(draft.tax_total || 0),
      shipping_total: roundToTwo(draft.shipping_total || 0),
      discount_total: roundToTwo(draft.discount_total || 0),
      refund_total: roundToTwo(draft.refund_total || 0),
      grand_total: getGrandTotalPreview(order),
      items: (order.items || []).map((item) => ({
        id: item.id,
        soid: item.soid,
        csoid: item.csoid,
        sku: item.sku,
        status: normalizedStatus,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: roundToTwo(item.unit_price || 0),
        subtotal: roundToTwo(item.subtotal || 0),
      })),
    };
  };

  const buildUpdatePayload = (orderPayload) => ({
    tax_total: roundToTwo(orderPayload.tax_total || 0),
    shipping_total: roundToTwo(orderPayload.shipping_total || 0),
    discount_total: roundToTwo(orderPayload.discount_total || 0),
    refund_total: roundToTwo(orderPayload.refund_total || 0),
    comments: (orderPayload.comments || '').trim(),
    status: (orderPayload.status || 'confirmed').toLowerCase(),
    vendor_name: String(orderPayload.vendor_name || 'None').trim() || 'None',
    items: (orderPayload.items || []).map((item) => ({
      id: item.id,
      quantity: Number(item.quantity || 0),
      unit_price: roundToTwo(item.unit_price || 0),
      status: (item.status || 'confirmed').toLowerCase(),
    })),
    vendor_website_order_date: orderPayload.vendor_website_order_date || null,
    vendor_website_order_number: (orderPayload.vendor_website_order_number || '').trim(),
  });

  const handleSaveSingleOrder = async (order) => {
    const orderKey = getOrderKey(order);
    if (!order?.soid) {
      setSupplierError('Cannot save this order because SOID is missing. Regenerate supplier orders.');
      return;
    }

    const validationError = validateSingleSupplierOrder(order);
    if (validationError) {
      setSupplierError(validationError);
      return;
    }

    setSupplierError('');
    setSuccessMessage('');
    setSavingOrderKeys((prev) => ({ ...prev, [orderKey]: true }));

    try {
      const orderPayload = buildOrderPayload(order);
      await updateSupplierOrder(order.soid, buildUpdatePayload(orderPayload));
      await loadSupplierOrders(Number(selectedOrder?.CSOID ?? selectedOrder?.csoid ?? 0));
      setSuccessMessage(`SOID ${order.soid} saved successfully.`);
    } catch (error) {
      setSupplierError(error.message || `Unable to save SOID ${order.soid}`);
    } finally {
      setSavingOrderKeys((prev) => {
        const next = { ...prev };
        delete next[orderKey];
        return next;
      });
    }
  };

  const prepareSupplierOrdersPayload = async () => {
    if (supplierOrders.length === 0) {
      setSupplierError('Generate supplier orders before final save');
      return;
    }

    const orderValidationErrors = [];

    for (const order of supplierOrders) {
      const draft = supplierFinancialDrafts[getOrderKey(order)] || {};
      const normalizedVendor = String(draft.vendor_name || order.vendor_name || '').trim() || 'None';
      const normalizedStatus = String(draft.status || order.status || 'confirmed').toLowerCase();

      if (normalizedStatus === 'confirmed' && normalizedVendor.toLowerCase() === 'none') {
        orderValidationErrors.push(`SOID ${order.soid}: vendor is required when status is confirmed`);
      }
      if (normalizedStatus === 'backordered' && normalizedVendor.toLowerCase() !== 'none') {
        orderValidationErrors.push(`SOID ${order.soid}: vendor must be None when status is backordered`);
      }

      const moneyFields = ['tax_total', 'shipping_total', 'discount_total', 'refund_total'];
      for (const field of moneyFields) {
        const raw = String(draft[field] ?? '0.00');
        if (!MONEY_INPUT_REGEX.test(raw)) {
          orderValidationErrors.push(`SOID ${order.soid}: ${field} must have at most 2 decimals`);
          continue;
        }
        if (Number(raw || 0) < 0) {
          orderValidationErrors.push(`SOID ${order.soid}: ${field} must be >= 0`);
        }
      }

      if (Number(draft.discount_total || 0) > Number(order.subtotal || 0)) {
        orderValidationErrors.push(`SOID ${order.soid}: discount cannot exceed subtotal`);
      }
    }

    if (orderValidationErrors.length > 0) {
      setSupplierError(orderValidationErrors[0]);
      return;
    }

    const csoid = Number(selectedOrder?.CSOID ?? selectedOrder?.csoid ?? 0);
    const payload = {
      csoid,
      supplier_orders: supplierOrders.map((order) => {
        const draft = supplierFinancialDrafts[order.soid] || {};
        const normalizedVendor = String(draft.vendor_name || order.vendor_name || 'None').trim() || 'None';
        const normalizedStatus = String(draft.status || order.status || 'confirmed').toLowerCase();
        return {
          soid: order.soid,
          csoid: order.csoid,
          cust_order_number: String(selectedOrder?.CustOrderNumber ?? selectedOrder?.cust_order_number ?? '').trim() || null,
          vendor_name: normalizedVendor,
          status: normalizedStatus,
          vendor_website_order_date: draft.vendor_website_order_date || null,
          vendor_website_order_number: (draft.vendor_website_order_number || '').trim(),
          comments: (draft.comments || '').trim(),
          subtotal: roundToTwo(order.subtotal || 0),
          tax_total: roundToTwo(draft.tax_total || 0),
          shipping_total: roundToTwo(draft.shipping_total || 0),
          discount_total: roundToTwo(draft.discount_total || 0),
          refund_total: roundToTwo(draft.refund_total || 0),
          grand_total: getGrandTotalPreview(order),
          items: (order.items || []).map((item) => ({
            id: item.id,
            soid: item.soid,
            csoid: item.csoid,
            sku: item.sku,
            status: normalizedStatus,
            product_name: item.product_name,
            quantity: item.quantity,
            unit_price: roundToTwo(item.unit_price || 0),
            subtotal: roundToTwo(item.subtotal || 0),
          })),
        };
      }),
    };

    setSupplierError('');

    setSavingSupplier(true);
    try {
      const csoidValue = Number(selectedOrder?.CSOID ?? selectedOrder?.csoid ?? 0);

      for (const orderPayload of payload.supplier_orders) {
        if (!orderPayload.soid) {
          continue;
        }
        await updateSupplierOrder(orderPayload.soid, buildUpdatePayload(orderPayload));
      }

      await loadSupplierOrders(csoidValue);
      setSuccessMessage('Supplier orders saved successfully.');
    } catch (error) {
      setSupplierError(error.message || 'Unable to save supplier orders');
    } finally {
      setSavingSupplier(false);
    }
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
            selectedItem={null}
            onSelectItem={() => {}}
          />
        </section>

        <section className="dashboard-half supplier-entry-half">
          <h2 className="section-heading">Supplier Orders</h2>

          {supplierError ? <p className="status-text error-text">{supplierError}</p> : null}
          {successMessage ? <p className="status-text success-text">{successMessage}</p> : null}

          <section className="panel">
            <div className="panel-head">
              <h3>Assign Vendor + Unit Price (preloaded SKUs only)</h3>
            </div>

            <div className="assignment-controls">
              <label>
                Website
                <select value={selectedWebsite} onChange={(event) => setSelectedWebsite(event.target.value)}>
                  <option value="">Select website</option>
                  {WEBSITE_OPTIONS.map((website) => (
                    <option key={website} value={website}>{website}</option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={generateSupplierOrders}
                disabled={savingSupplier || items.length === 0}
              >
                {savingSupplier ? 'Generating...' : 'Generate Supplier Orders'}
              </button>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Vendor</th>
                    <th>Unit Price</th>
                    <th>Subtotal</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty-cell">
                        Select a CSOID and load items first.
                      </td>
                    </tr>
                  ) : null}

                  {items.map((item) => {
                    const skuKey = getItemKey(item);
                    const entry = skuAssignments[skuKey] || {};
                    const errorText = assignmentErrors[skuKey] || '';
                    const qty = Number(entry.quantity || 0);
                    const unitPrice = Number(entry.unit_price || 0);
                    const subtotal = roundToTwo(qty * unitPrice);

                    return (
                      <tr key={skuKey}>
                        <td>{entry.sku || resolveItemField(item, ['Sku', 'sku'])}</td>
                        <td>{entry.product_name || resolveItemField(item, ['ProductName', 'product_name'])}</td>
                        <td>{entry.quantity || resolveItemField(item, ['Quantity', 'quantity'])}</td>
                        <td>
                          <select
                            value={entry.vendor_name || 'None'}
                            onChange={(event) => handleAssignmentChange(skuKey, 'vendor_name', event.target.value)}
                          >
                            <option value="None">None</option>
                            {vendorOptions.map((vendor) => (
                              vendor === 'None' ? null : <option key={vendor} value={vendor}>{vendor}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={entry.unit_price || ''}
                            disabled={(entry.vendor_name || 'None').toLowerCase() === 'none'}
                            onChange={(event) => handleAssignmentChange(skuKey, 'unit_price', event.target.value)}
                          />
                        </td>
                        <td>${formatMoney(subtotal)}</td>
                        <td className="error-text">{errorText}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="supplier-card-list">
            {supplierLoading ? <p className="status-text">Loading supplier orders...</p> : null}

            {!supplierLoading && supplierOrders.length === 0 ? (
              <p className="status-text">No supplier orders yet for this CSOID.</p>
            ) : null}

            {supplierOrders.map((order) => {
              const orderKey = getOrderKey(order);
              return (
                <SupplierOrderCard
                  key={orderKey}
                  order={order}
                  financialDraft={supplierFinancialDrafts[orderKey] || {
                    vendor_name: order.vendor_name || 'None',
                    status: order.status || 'confirmed',
                    vendor_website_order_date: order.vendor_website_order_date || '',
                    vendor_website_order_number: order.vendor_website_order_number || '',
                    tax_total: formatMoney(order.tax_total),
                    shipping_total: formatMoney(order.shipping_total),
                    discount_total: formatMoney(order.discount_total),
                    refund_total: formatMoney(order.refund_total),
                    comments: order.comments || '',
                  }}
                  onFinancialChange={handleFinancialDraftChange}
                  onItemChange={handleOrderItemChange}
                  isEditing={Boolean(editingOrderKeys[orderKey])}
                  onToggleEdit={() => handleToggleOrderEdit(orderKey)}
                  onSave={() => handleSaveSingleOrder(order)}
                  isSaving={Boolean(savingOrderKeys[orderKey])}
                  vendorOptions={vendorOptions}
                  previewGrandTotal={getGrandTotalPreview(order)}
                />
              );
            })}


          </section>
        </section>
      </div>
    </AppShell>
  );
}
