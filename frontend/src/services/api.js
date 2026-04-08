import { getToken } from './auth';

function resolveApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (configuredBaseUrl && configuredBaseUrl.trim()) {
    return configuredBaseUrl.trim().replace(/\/+$/, '');
  }

  // In local development, go through Vite proxy to avoid host/CORS issues.
  return '/api';
}

const API_BASE_URL = resolveApiBaseUrl();

async function parseJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }
  return response.json();
}

function formatApiErrorDetail(detail) {
  if (Array.isArray(detail)) {
    return detail
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (entry && typeof entry === 'object') {
          return entry.msg || entry.message || JSON.stringify(entry);
        }
        return String(entry);
      })
      .filter(Boolean)
      .join(', ');
  }
  if (detail && typeof detail === 'object') {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return String(detail || '');
}

async function fetchWithFallback(paths, options = {}) {
  let lastError = null;

  for (const path of paths) {
    try {
      const token = getToken();
      const headers = {
        ...(options.headers || {}),
      };
      if (token && !headers.Authorization) {
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers,
      });
      const data = await parseJsonResponse(response);

      if (!response.ok) {
        const message = data?.detail ? formatApiErrorDetail(data.detail) : `Request failed with status ${response.status}`;
        throw new Error(message);
      }

      return data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to connect to backend API');
}

function normalizeOrders(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.orders)) {
    return payload.orders;
  }
  return [];
}

function normalizeItems(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  return [];
}

export async function searchOrders({
  orderRef,
  filterType,
  filterDate,
  filterStartDate,
  filterEndDate,
}) {
  const params = new URLSearchParams();
  const trimmedOrderRef = (orderRef || '').trim();

  if (trimmedOrderRef) {
    params.set('orderRef', trimmedOrderRef);
  }

  if (filterType === 'range') {
    if (filterStartDate && filterEndDate) {
      params.set('filterType', filterType);
      params.set('filterStartDate', filterStartDate);
      params.set('filterEndDate', filterEndDate);
    }
  } else if (filterType && filterDate) {
    params.set('filterType', filterType);
    params.set('filterDate', filterDate);
  }

  const queryString = params.toString();
  const orderData = await fetchWithFallback([`/orders${queryString ? `?${queryString}` : ''}`]);

  return normalizeOrders(orderData);
}

export async function fetchOrderItems(csoid) {
  const data = await fetchWithFallback([`/order-items/${csoid}`]);

  return normalizeItems(data);
}

export async function fetchNextOrderNumber() {
  const data = await fetchWithFallback(['/supplier/orders/next-order-number']);
  if (!data?.orderNumber) {
    throw new Error('No order number returned from server');
  }
  return String(data.orderNumber);
}

export async function checkSoidExists(soid) {
  const data = await fetchWithFallback([`/supplier/orders/soid-exists/${soid}`]);
  return Boolean(data?.exists);
}

export async function createSupplierOrders(payload) {
  return fetchWithFallback(['/supplier/orders'], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchSupplierOrders(csoid, statusFilter) {
  const params = new URLSearchParams();
  if (statusFilter) {
    params.set('status', statusFilter);
  }
  const queryString = params.toString();
  const data = await fetchWithFallback([`/supplier/orders/${csoid}${queryString ? `?${queryString}` : ''}`]);
  if (Array.isArray(data)) {
    return data;
  }
  return [];
}

export async function fetchAllBackorderedOrders() {
  const data = await fetchWithFallback(['/supplier/orders/status/backordered']);
  if (Array.isArray(data)) {
    return data;
  }
  return [];
}

export async function fetchSupplierFollowupAlerts() {
  const data = await fetchWithFallback(['/supplier/orders/follow-up-alerts']);
  if (Array.isArray(data)) {
    return data;
  }
  return [];
}

export async function updateSupplierOrder(soid, payload) {
  return fetchWithFallback([`/supplier/orders/${soid}`], {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

export async function deleteSupplierOrder(soid) {
  return fetchWithFallback([`/supplier/orders/${soid}`], {
    method: 'DELETE',
  });
}

export async function moveSupplierOrderSku(payload) {
  return fetchWithFallback(['/supplier/orders/move-sku'], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}
