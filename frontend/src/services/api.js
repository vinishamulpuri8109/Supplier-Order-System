const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

async function parseJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }
  return response.json();
}

async function fetchWithFallback(paths, options = {}) {
  let lastError = null;

  for (const path of paths) {
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, options);
      const data = await parseJsonResponse(response);

      if (!response.ok) {
        const message = data?.detail || `Request failed with status ${response.status}`;
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
  csoid,
  filterType,
  filterDate,
  filterStartDate,
  filterEndDate,
}) {
  const params = new URLSearchParams();
  const trimmedCsoid = (csoid || '').trim();

  if (trimmedCsoid) {
    params.set('csoid', trimmedCsoid);
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
  const data = await fetchWithFallback(['/supplier/next-order-number']);
  if (!data?.orderNumber) {
    throw new Error('No order number returned from server');
  }
  return String(data.orderNumber);
}

export async function checkSoidExists(soid) {
  const data = await fetchWithFallback([`/supplier/soid-exists/${soid}`]);
  return Boolean(data?.exists);
}

export async function saveSupplierData(payload, context = {}) {
  const selectedCsoid = Number(context.selectedOrder?.CSOID ?? context.selectedOrder?.csoid ?? 0);

  const dashboardPayload = {
    ...payload,
    csoid: Number.isFinite(selectedCsoid) && selectedCsoid > 0 ? selectedCsoid : null,
  };

  return fetchWithFallback(['/supplier'], {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(dashboardPayload),
  });
}
