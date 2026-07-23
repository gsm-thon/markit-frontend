const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

export const API_ENDPOINTS = {
  createScan: '/api/v1/scans',
  updateFinding: '/api/v1/scans/{scanId}/findings/{findingId}',
  createSafeCopy: '/api/v1/scans/{scanId}/safe-copy',
  deleteScan: '/api/v1/scans/{scanId}',
}

export async function createScan({ file, mode, consent }) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('mode', mode)
  formData.append('consent', String(consent))

  const payload = await requestJson(`${API_BASE_URL}/scans`, {
    method: 'POST',
    body: formData,
  })

  return payload.data
}

export async function updateFinding(scanId, findingId, body) {
  const payload = await requestSessionJson(`${API_BASE_URL}/scans/${scanId}/findings/${findingId}`, () => ({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

  return payload.data
}

export async function createSafeCopy(scanId, format) {
  const response = await requestSessionResponse(`${API_BASE_URL}/scans/${scanId}/safe-copy`, () => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format }),
  }))

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw Object.assign(new Error(payload?.error?.message || 'Request failed'), { payload })
  }

  return response.blob()
}

export async function deleteScanSession(scanId) {
  const payload = await requestSessionJson(`${API_BASE_URL}/scans/${scanId}`, () => ({
    method: 'DELETE',
  }))

  return payload.data
}

export function getApiErrorMessage(error, fallback) {
  return error?.payload?.error?.message || error?.message || fallback
}

async function requestJson(url, options) {
  const response = await fetch(url, options)
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload?.success) {
    throw Object.assign(new Error(payload?.error?.message || 'Request failed'), { payload })
  }

  return payload
}

async function requestSessionJson(url, createOptions) {
  const response = await requestSessionResponse(url, createOptions)
  const payload = await response.json().catch(() => null)

  if (!response.ok || !payload?.success) {
    throw Object.assign(new Error(payload?.error?.message || 'Request failed'), { payload })
  }

  return payload
}

async function requestSessionResponse(url, createOptions) {
  let lastResponse = null

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(url, createOptions())

    if (!shouldRetrySessionRequest(response)) {
      return response
    }

    lastResponse = response
    await delay(160 + attempt * 120)
  }

  return lastResponse
}

function shouldRetrySessionRequest(response) {
  return response.status === 404 || response.status === 410
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
