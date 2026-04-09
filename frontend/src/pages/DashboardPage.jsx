import AppShell from '../components/layout/AppShell';
import OrderSearchCard from '../components/orders/OrderSearchCard';
import OrderItemsTable from '../components/orders/OrderItemsTable';
import SupplierOrderCard from '../components/supplier/SupplierOrderCard';
import BackorderWidget from '../components/supplier/BackorderWidget';
import { useEffect, useMemo, useState } from 'react';
import { WEBSITE_OPTIONS, WEBSITE_VENDOR_MAP } from '../constants/supplierOptions';
import {
  createSupplierOrders,
  deleteSupplierOrdersByPo,
  fetchAllBackorderedOrders,
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
  return String(item.Sku ?? item.sku ?? item.orderItemId ?? '');
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

function buildLocalSupplierOrders(csoid, assignments) {
  const grouped = {};

  for (const assignment of Object.values(assignments)) {
    const vendor = String(assignment.vendor_name || 'None').trim() || 'None';
    const itemStatus = vendor === 'None' ? 'backordered' : 'confirmed';
    const groupKey = vendor === 'None' ? `backordered-${assignment.sku}` : vendor;
    if (!grouped[groupKey]) {
      grouped[groupKey] = [];
    }

    const quantity = Number(assignment.quantity || 0);
    const unitPrice = 0;
    const subtotal = roundToTwo(quantity * unitPrice);

    grouped[groupKey].push({
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
    const resolvedVendorName = vendor.startsWith('backordered-') ? 'None' : vendor;
    return {
      soid: null,
      draft_id: draftId,
      csoid,
      vendor_name: resolvedVendorName,
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
  const [orderFilterStartDate, setOrderFilterStartDate] = useState('');
  const [orderFilterEndDate, setOrderFilterEndDate] = useState('');

  const [orders, setOrders] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [selectedWebsite, setSelectedWebsite] = useState('');

  const [ordersLoading, setOrdersLoading] = useState(false);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [supplierLoading, setSupplierLoading] = useState(false);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [deletingByPo, setDeletingByPo] = useState(false);

  const [ordersError, setOrdersError] = useState('');
  const [itemsError, setItemsError] = useState('');
  const [supplierError, setSupplierError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [skuAssignments, setSkuAssignments] = useState({});
  const [assignmentErrors, setAssignmentErrors] = useState({});
  const [supplierOrders, setSupplierOrders] = useState([]);
  const [globalBackorderedOrders, setGlobalBackorderedOrders] = useState([]);
  const [supplierFinancialDrafts, setSupplierFinancialDrafts] = useState({});
  const [orderMessages, setOrderMessages] = useState({});
  const [supplierStatusFilter, setSupplierStatusFilter] = useState('all');
  const [globalBackorderedCount, setGlobalBackorderedCount] = useState(0);
  const [globalBackorderedLoading, setGlobalBackorderedLoading] = useState(false);
  const [editingOrderKeys, setEditingOrderKeys] = useState({});
  const [savingOrderKeys, setSavingOrderKeys] = useState({});
  const [orderEditSnapshots, setOrderEditSnapshots] = useState({});
  const vendorOptions = useMemo(() => {
    // Get vendors from selected website (primary source)
    const fromWebsite = selectedWebsite ? (WEBSITE_VENDOR_MAP[selectedWebsite] || []) : [];
    
    // Get vendors from current assignments (secondary source - custom vendors)
    const fromAssignments = Object.values(skuAssignments)
      .map((entry) => (entry?.vendor_name || '').trim())
      .filter((value) => Boolean(value) && value !== 'None');
    
    // Get vendors from existing orders (tertiary source)
    const fromOrders = supplierOrders
      .map((order) => (order.vendor_name || '').trim())
      .filter((value) => Boolean(value) && value !== 'None');
    
    // Combine all sources: website vendors take priority, then custom from assignments, then from orders
    const combined = [...new Set([...fromWebsite, ...fromAssignments, ...fromOrders])];
    
    // Always include 'None' as the first option
    return ['None', ...combined];
  }, [selectedWebsite, skuAssignments, supplierOrders]);

  const filteredSupplierOrders = useMemo(() => {
    if (supplierStatusFilter === 'backordered') {
      return supplierOrders.filter((order) => String(order.status || '').toLowerCase() === 'backordered');
    }

    return supplierOrders;
  }, [supplierOrders, supplierStatusFilter]);

  const hydrateFinancialDrafts = (orders, openBackorderedForEdit = false) => {
    if (openBackorderedForEdit) {
      const editableKeys = Object.fromEntries(
        (orders || [])
          .filter((order) => String(order.status || '').toLowerCase() === 'backordered')
          .map((order) => [getOrderKey(order), true])
      );
      setEditingOrderKeys(editableKeys);
    } else {
      setEditingOrderKeys({});
    }

    setSupplierFinancialDrafts((prev) => {
      const next = { ...prev };
      for (const order of orders || []) {
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
  };

  const refreshGlobalBackorderedCount = async () => {
    setGlobalBackorderedLoading(true);
    try {
      const allBackordered = await fetchAllBackorderedOrders();
      setGlobalBackorderedOrders(allBackordered);
      setGlobalBackorderedCount(allBackordered.length);
      return allBackordered;
    } catch {
      setGlobalBackorderedOrders([]);
      setGlobalBackorderedCount(0);
      return [];
    } finally {
      setGlobalBackorderedLoading(false);
    }
  };

  useEffect(() => {
    refreshGlobalBackorderedCount();
  }, []);

  const initializeAssignments = (fetchedItems, existingOrders = [], orderContext = selectedOrder) => {
    const persistedBySku = {};
    for (const order of existingOrders || []) {
      const vendorName = String(order?.vendor_name || 'None').trim() || 'None';
      for (const item of order?.items || []) {
        const sku = String(item?.sku || '').trim().toUpperCase();
        if (!sku || persistedBySku[sku]) {
          continue;
        }
        persistedBySku[sku] = {
          vendor_name: vendorName,
          status: String(item?.status || item?.availability_status || '').trim().toLowerCase(),
        };
      }
    }

    const nextAssignments = {};
    for (const item of fetchedItems) {
      const key = getItemKey(item);
      const sku = String(resolveItemField(item, ['Sku', 'sku'])).trim().toUpperCase();
      const quantity = Number(resolveItemField(item, ['Quantity', 'quantity']) || 0);
      const persisted = persistedBySku[sku];
      const persistedVendor = String(persisted?.vendor_name || 'None').trim() || 'None';
      const nextStatus = persistedVendor.toLowerCase() === 'none' ? 'backordered' : 'confirmed';

      nextAssignments[key] = {
        sku,
        product_name: String(resolveItemField(item, ['ProductName', 'product_name'])) || sku,
        quantity,
        cust_order_number: String(orderContext?.CustOrderNumber ?? orderContext?.cust_order_number ?? '').trim(),
        status: nextStatus,
        vendor_name: persistedVendor,
        unit_price: 0,
      };
    }
    setSkuAssignments(nextAssignments);
    setAssignmentErrors({});
  };

  const loadSupplierOrders = async (csoid, statusFilter = supplierStatusFilter, openBackorderedForEdit = false) => {
    if (!csoid) {
      setSupplierOrders([]);
      return [];
    }

    setSupplierLoading(true);
    setSupplierError('');
    try {
      const data = await fetchSupplierOrders(csoid, statusFilter === 'all' ? '' : statusFilter);
      setSupplierOrders(data);
      hydrateFinancialDrafts(data, openBackorderedForEdit);
      await refreshGlobalBackorderedCount();
      return data;
    } catch (error) {
      setSupplierOrders([]);
      setSupplierFinancialDrafts({});
      setSupplierError(error.message || 'Unable to load supplier orders');
      return [];
    } finally {
      setSupplierLoading(false);
    }
  };

  const handleSupplierStatusFilterChange = async (nextFilter) => {
    setSupplierStatusFilter(nextFilter);
    const csoidValue = Number(selectedOrder?.CSOID ?? selectedOrder?.csoid ?? 0);
    if (csoidValue) {
      await loadSupplierOrders(csoidValue, nextFilter);
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
    setOrderMessages({});

    try {
      const fetchedItems = await fetchOrderItems(csoid);
      setItems(fetchedItems);
      const loadedOrders = await loadSupplierOrders(csoid, supplierStatusFilter);
      initializeAssignments(fetchedItems, loadedOrders, order);
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
      const results = await searchOrders({
        orderRef: csoidSearchValue,
        filterType: orderFilterType,
        filterStartDate: orderFilterStartDate,
        filterEndDate: orderFilterEndDate,
      });

      setOrders(results);
      setItems([]);
      setSupplierOrders([]);
      setSupplierFinancialDrafts({});
      setOrderMessages({});

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
      setOrderMessages({});
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleSelectOrder = (order) => {
    setSelectedOrder(order);
    loadOrderItems(order);
  };

  const handleClearDateFilter = () => {
    setOrderFilterType('');
    setOrderFilterStartDate('');
    setOrderFilterEndDate('');
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
      const itemStatus = String(assignment.vendor_name || 'None').trim().toLowerCase() === 'none' ? 'backordered' : 'confirmed';

      if (!ITEM_STATUSES.includes(itemStatus)) {
        rowErrors.push('Status is invalid');
      }

      if (itemStatus === 'confirmed' && !(assignment.vendor_name || '').trim()) {
        rowErrors.push('Vendor is required');
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
      const persistedOrders = await fetchSupplierOrders(csoid, supplierStatusFilter === 'all' ? '' : supplierStatusFilter);
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
      await refreshGlobalBackorderedCount();
      setSuccessMessage('Supplier orders created. Review the saved SOIDs and fill in the fields below.');
    } catch (error) {
      setSupplierError(error.message || 'Unable to generate supplier orders');
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleDeleteAssignmentsForPo = async () => {
    const csoid = Number(selectedOrder?.CSOID ?? selectedOrder?.csoid ?? 0);
    const custOrderNumber = String(selectedOrder?.CustOrderNumber ?? selectedOrder?.cust_order_number ?? '').trim();

    if (!csoid || !custOrderNumber) {
      setSupplierError('Select an order with a PO first.');
      return;
    }

    const confirmed = window.confirm(
      `Delete all supplier assignments for PO #${custOrderNumber}? This will remove all generated SOIDs for this PO.`
    );
    if (!confirmed) {
      return;
    }

    setDeletingByPo(true);
    setSupplierError('');
    setSuccessMessage('');

    try {
      const result = await deleteSupplierOrdersByPo({
        csoid,
        cust_order_number: custOrderNumber,
      });

      await loadSupplierOrders(csoid, supplierStatusFilter);
      await refreshGlobalBackorderedCount();
      setOrderMessages({});
      setEditingOrderKeys({});

      if (Number(result?.deleted_soid_count || 0) === 0) {
        setSuccessMessage(`No supplier assignments found for PO #${custOrderNumber}.`);
      } else {
        setSuccessMessage(
          `Deleted ${result.deleted_soid_count} SOID(s) and ${result.deleted_item_count} item(s) for PO #${custOrderNumber}.`
        );
      }
    } catch (error) {
      setSupplierError(error.message || 'Unable to delete supplier assignments for this PO');
    } finally {
      setDeletingByPo(false);
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

  const handleOrderItemChange = (soid, itemSku, field, value) => {
    setSupplierOrders((prev) => prev.map((order) => {
      if (getOrderKey(order) !== String(soid)) {
        return order;
      }
      const lockedOrderStatus = String(order.status || 'confirmed').toLowerCase();
      const nextItems = (order.items || []).map((item) => {
        if (String(item.sku || '').toUpperCase() !== String(itemSku || '').toUpperCase()) {
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
        status: lockedOrderStatus,
      };
    }));
  };

  const getGrandTotalPreview = (order) => {
    const draft = supplierFinancialDrafts[getOrderKey(order)] || {};
    const subtotal = roundToTwo(order.subtotal || 0);
    const tax = roundToTwo(draft.tax_total || 0);
    const shipping = roundToTwo(draft.shipping_total || 0);
    const discount = roundToTwo(draft.discount_total || 0);
    return roundToTwo(subtotal + tax + shipping - discount);
  };

  const cloneForSnapshot = (value) => JSON.parse(JSON.stringify(value));

  const handleToggleOrderEdit = (orderKey) => {
    const isCurrentlyEditing = editingOrderKeys[orderKey];
    const normalizedOrderKey = String(orderKey);

    if (!isCurrentlyEditing) {
      const currentOrder = supplierOrders.find((order) => getOrderKey(order) === normalizedOrderKey);
      if (currentOrder) {
        setOrderEditSnapshots((prev) => ({
          ...prev,
          [normalizedOrderKey]: {
            order: cloneForSnapshot(currentOrder),
            draft: supplierFinancialDrafts[normalizedOrderKey]
              ? cloneForSnapshot(supplierFinancialDrafts[normalizedOrderKey])
              : null,
          },
        }));
      }
    }

    // If closing edit mode (clicking Cancel), discard unsaved changes
    if (isCurrentlyEditing) {
      const snapshot = orderEditSnapshots[normalizedOrderKey];

      if (snapshot?.order) {
        setSupplierOrders((prev) => prev.map((order) => (
          getOrderKey(order) === normalizedOrderKey ? snapshot.order : order
        )));
      }

      setSupplierFinancialDrafts((prev) => {
        const updated = { ...prev };

        if (snapshot?.draft) {
          updated[normalizedOrderKey] = snapshot.draft;
        } else {
          delete updated[normalizedOrderKey];
        }

        return updated;
      });

      setOrderMessages((prev) => {
        if (!prev[normalizedOrderKey]) {
          return prev;
        }
        const next = { ...prev };
        delete next[normalizedOrderKey];
        return next;
      });

      setOrderEditSnapshots((prev) => {
        const next = { ...prev };
        delete next[normalizedOrderKey];
        return next;
      });
    }

    setEditingOrderKeys((prev) => ({
      ...prev,
      [normalizedOrderKey]: !prev[normalizedOrderKey],
    }));
  };

  const validateSingleSupplierOrder = (order) => {
    const draft = supplierFinancialDrafts[getOrderKey(order)] || {};
    const normalizedVendor = String(draft.vendor_name || order.vendor_name || '').trim() || 'None';
    const normalizedStatus = String(draft.status || order.status || 'confirmed').toLowerCase();
    const isVendorSelected = normalizedVendor.toLowerCase() !== 'none';

    if (normalizedStatus === 'confirmed' && !isVendorSelected) {
      return `SOID ${order.soid}: vendor is required when status is confirmed`;
    }
    if (normalizedStatus === 'backordered' && isVendorSelected) {
      return `SOID ${order.soid}: vendor must be None when status is backordered`;
    }

    // When vendor is selected, require all fields except comments
    if (isVendorSelected) {
      // Check vendor_website_order_date
      if (!draft.vendor_website_order_date || draft.vendor_website_order_date.trim() === '') {
        return `SOID ${order.soid}: vendor website order date is required when vendor is selected`;
      }
      // Check vendor_website_order_number
      if (!draft.vendor_website_order_number || String(draft.vendor_website_order_number).trim() === '') {
        return `SOID ${order.soid}: vendor website order number is required when vendor is selected`;
      }
    }

    if (normalizedStatus === 'confirmed') {
      const invalidItem = (order.items || []).find((item) => Number(item.unit_price || 0) <= 0);
      if (invalidItem) {
        return `SOID ${order.soid}: unit price must be greater than 0 for confirmed status (SKU ${invalidItem.sku})`;
      }
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
        sku: item.sku,
        soid: item.soid,
        csoid: item.csoid,
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
      sku: item.sku,
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
      setOrderMessages((prev) => ({
        ...prev,
        [orderKey]: { type: 'error', text: 'Cannot save this order because SOID is missing. Regenerate supplier orders.' },
      }));
      return;
    }

    const validationError = validateSingleSupplierOrder(order);
    if (validationError) {
      setOrderMessages((prev) => ({
        ...prev,
        [orderKey]: { type: 'error', text: validationError },
      }));
      return;
    }

    setSavingOrderKeys((prev) => ({ ...prev, [orderKey]: true }));

    try {
      const orderPayload = buildOrderPayload(order);
      await updateSupplierOrder(order.soid, buildUpdatePayload(orderPayload));

      await loadSupplierOrders(Number(selectedOrder?.CSOID ?? selectedOrder?.csoid ?? 0), supplierStatusFilter);
      await refreshGlobalBackorderedCount();

      setOrderMessages((prev) => ({
        ...prev,
        [orderKey]: { type: 'success', text: `SOID ${order.soid} saved successfully.` },
      }));
      
      // Close edit mode after successful save
      setEditingOrderKeys((prev) => {
        const next = { ...prev };
        delete next[orderKey];
        return next;
      });

      setOrderEditSnapshots((prev) => {
        const next = { ...prev };
        delete next[orderKey];
        return next;
      });
      
      // Clear the draft for this order
      setSupplierFinancialDrafts((prev) => {
        const next = { ...prev };
        delete next[orderKey];
        return next;
      });
    } catch (error) {
      setOrderMessages((prev) => ({
        ...prev,
        [orderKey]: { type: 'error', text: error.message || `Unable to save SOID ${order.soid}` },
      }));
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
      if (normalizedStatus === 'confirmed') {
        const invalidItem = (order.items || []).find((item) => Number(item.unit_price || 0) <= 0);
        if (invalidItem) {
          orderValidationErrors.push(`SOID ${order.soid}: unit price must be greater than 0 for confirmed status (SKU ${invalidItem.sku})`);
        }
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
            sku: item.sku,
            soid: item.soid,
            csoid: item.csoid,
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
        <section className="panel backorder-global-panel">
          <div className="panel-head">
            <h3>Backordered Orders</h3>
          </div>
          <BackorderWidget count={globalBackorderedCount} />

          {globalBackorderedLoading ? <p className="status-text">Loading backordered SOIDs...</p> : null}
          {!globalBackorderedLoading && globalBackorderedOrders.length === 0 ? (
            <p className="status-text">No backordered orders found.</p>
          ) : null}

          {!globalBackorderedLoading && globalBackorderedOrders.length > 0 ? (
            <div className="backorder-list-wrap">
              <table className="data-table backorder-list-table">
                <thead>
                  <tr>
                    <th>SOID</th>
                    <th>PO</th>
                  </tr>
                </thead>
                <tbody>
                  {globalBackorderedOrders.map((order) => (
                    <tr key={`backorder-row-${order.soid}`}>
                      <td>#{order.soid}</td>
                      <td>{order.cust_order_number ? `#${order.cust_order_number}` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="dashboard-half order-data-half">
          <h2 className="section-heading">Order Data</h2>
          <OrderSearchCard
            csoidSearchValue={csoidSearchValue}
            onCsoidSearchValueChange={setCsoidSearchValue}
            filterType={orderFilterType}
            onFilterTypeChange={setOrderFilterType}
            filterStartDate={orderFilterStartDate}
            filterEndDate={orderFilterEndDate}
            onFilterStartDateChange={setOrderFilterStartDate}
            onFilterEndDateChange={setOrderFilterEndDate}
            onClearDateFilter={handleClearDateFilter}
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
              <h3>Assign Vendor (preloaded SKUs only)</h3>
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
                disabled={savingSupplier || deletingByPo || items.length === 0}
              >
                {savingSupplier ? 'Generating...' : 'Generate Supplier Orders'}
              </button>

              <button
                type="button"
                className="ghost"
                onClick={handleDeleteAssignmentsForPo}
                disabled={deletingByPo || savingSupplier || !selectedOrder || supplierOrders.length === 0}
              >
                {deletingByPo ? 'Deleting...' : 'Delete All Assigning For This PO'}
              </button>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Vendor</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty-cell">
                        Select a CSOID and load items first.
                      </td>
                    </tr>
                  ) : null}

                  {items.map((item) => {
                    const skuKey = getItemKey(item);
                    const entry = skuAssignments[skuKey] || {};
                    const errorText = assignmentErrors[skuKey] || '';

                    return (
                      <tr key={skuKey}>
                        <td>{entry.sku || resolveItemField(item, ['Sku', 'sku'])}</td>
                        <td>{entry.product_name || resolveItemField(item, ['ProductName', 'product_name'])}</td>
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
                        <td className="error-text">{errorText}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="supplier-card-list">
            <div className="panel-head">
              <h3>Supplier Orders</h3>
            </div>
            {supplierLoading ? <p className="status-text">Loading supplier orders...</p> : null}

            {!supplierLoading && supplierOrders.length === 0 ? (
              <p className="status-text">No supplier orders yet for this CSOID.</p>
            ) : null}

            {!supplierLoading && supplierOrders.length > 0 && filteredSupplierOrders.length === 0 ? (
              <p className="status-text">No backordered supplier orders found for this selection.</p>
            ) : null}

            <div className="supplier-card-grid">
              {filteredSupplierOrders.map((order) => {
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
                    orderMessage={orderMessages[orderKey] || null}
                  />
                );
              })}
            </div>


          </section>
        </section>
      </div>
    </AppShell>
  );
}
