import { useMemo, useRef, useState } from 'react'
import {
  API_ENDPOINTS,
  createSafeCopy,
  createScan,
  deleteScanSession,
  getApiErrorMessage,
  updateFinding,
} from './api'
import './App.css'

const scanModes = [
  { value: 'privacy', label: '개인정보 보호' },
  { value: 'blind_hiring', label: '블라인드 채용' },
]

const safeFormats = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'DOCX' },
  { value: 'txt', label: 'TXT' },
]

const apiStatus = [
  ['사용 중', 'POST', API_ENDPOINTS.createScan, '파일 업로드와 즉시 분석'],
  ['사용 중', 'PATCH', API_ENDPOINTS.updateFinding, '탐지 항목 수정 반영'],
  ['사용 중', 'POST', API_ENDPOINTS.createSafeCopy, '마스킹 사본 다운로드'],
  ['사용 중', 'DELETE', API_ENDPOINTS.deleteScan, '원본 및 분석 세션 삭제'],
  ['제거됨', 'GET', '/api/v1/scans/{scanId}', '서버에 없는 결과 조회 API'],
  ['제거됨', 'POST', '/api/v1/scans/{scanId}/preview', '서버에 없는 미리보기 API'],
]

function App() {
  const fileInputRef = useRef(null)
  const [mode, setMode] = useState('privacy')
  const [consent, setConsent] = useState(true)
  const [scan, setScan] = useState(null)
  const [findings, setFindings] = useState([])
  const [selectedFindingId, setSelectedFindingId] = useState(null)
  const [format, setFormat] = useState('pdf')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  const selectedFinding = useMemo(
    () => findings.find((finding) => finding.findingId === selectedFindingId) ?? findings[0] ?? null,
    [findings, selectedFindingId],
  )

  const resolvedCount = findings.filter((finding) => finding.resolved).length
  const activeCount = findings.length - resolvedCount

  async function handleFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) return

    if (!consent) {
      setMessage('민감정보 탐지 및 안전 사본 생성을 진행하려면 동의가 필요합니다.')
      return
    }

    setBusy('scan')
    setMessage('')

    try {
      const result = await createScan({ file, mode, consent })
      setScan(result)
      setFindings(result.findings ?? [])
      setSelectedFindingId(result.findings?.[0]?.findingId ?? null)
    } catch (error) {
      setMessage(getApiErrorMessage(error, '문서 분석에 실패했습니다.'))
    } finally {
      setBusy('')
      event.target.value = ''
    }
  }

  async function handleResolve(finding, replacementText = getDefaultReplacement(finding)) {
    if (!scan?.scanId || !finding) return

    setBusy(finding.findingId)
    setMessage('')

    try {
      const updated = await updateFinding(scan.scanId, finding.findingId, {
        action: finding.action,
        replacementText,
        resolved: true,
      })

      setFindings((items) =>
        items.map((item) =>
          item.findingId === finding.findingId
            ? {
                ...item,
                resolved: updated.resolved ?? true,
                replacementText: updated.replacementText ?? replacementText,
              }
            : item,
        ),
      )
    } catch (error) {
      setMessage(getApiErrorMessage(error, '수정 반영에 실패했습니다.'))
    } finally {
      setBusy('')
    }
  }

  async function handleDownload() {
    if (!scan?.scanId) {
      setMessage('먼저 문서를 분석해 주세요.')
      return
    }

    setBusy('download')
    setMessage('')

    try {
      const blob = await createSafeCopy(scan.scanId, format)
      downloadBlob(blob, `maskit-safe-copy.${format}`)
    } catch (error) {
      setMessage(getApiErrorMessage(error, '안전 사본 생성에 실패했습니다.'))
    } finally {
      setBusy('')
    }
  }

  async function handleDelete() {
    const scanId = scan?.scanId
    setBusy('delete')
    setMessage('')

    try {
      if (scanId) await deleteScanSession(scanId)
      setScan(null)
      setFindings([])
      setSelectedFindingId(null)
    } catch (error) {
      setMessage(getApiErrorMessage(error, '세션 삭제에 실패했습니다.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Maskit</p>
          <h1>문서 속 민감정보를 찾고 안전한 사본으로 저장합니다.</h1>
        </div>
        <button className="ghost-button" type="button" onClick={handleDelete} disabled={busy === 'delete'}>
          새 분석
        </button>
      </header>

      {message && <div className="message">{message}</div>}

      <section className="layout">
        <section className="panel upload-panel">
          <div className="section-title">
            <span>1</span>
            <div>
              <h2>문서 업로드</h2>
              <p>서버의 `POST /api/v1/scans`와 바로 연결됩니다.</p>
            </div>
          </div>

          <div className="dropzone">
            <strong>{busy === 'scan' ? '분석 중입니다...' : 'PDF, DOCX, HWPX, TXT, PNG, JPG'}</strong>
            <p>파일은 서버 메모리에서 분석되고, 응답의 `extractedText`와 `findings`로 화면을 구성합니다.</p>
            <input
              ref={fileInputRef}
              className="file-input"
              type="file"
              accept=".pdf,.docx,.hwpx,.txt,.png,.jpg,.jpeg"
              onChange={handleFileChange}
            />
            <button
              className="primary-button"
              type="button"
              disabled={busy === 'scan'}
              onClick={() => fileInputRef.current?.click()}
            >
              파일 선택
            </button>
          </div>

          <div className="form-grid">
            <label>
              검사 모드
              <select value={mode} onChange={(event) => setMode(event.target.value)}>
                {scanModes.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-line">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              민감정보 탐지 및 안전 사본 생성에 동의합니다.
            </label>
          </div>
        </section>

        <section className="panel">
          <div className="section-title">
            <span>2</span>
            <div>
              <h2>API 정합성</h2>
              <p>서버 레포 기준으로 현재 프론트에 남긴 API와 제거한 API입니다.</p>
            </div>
          </div>
          <div className="api-list">
            {apiStatus.map(([status, method, path, description]) => (
              <article className="api-row" key={`${method}-${path}`}>
                <span className={status === '사용 중' ? 'status ok' : 'status removed'}>{status}</span>
                <strong>{method}</strong>
                <code>{path}</code>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
      </section>

      <section className="result-grid">
        <section className="panel result-panel">
          <div className="section-title">
            <span>3</span>
            <div>
              <h2>분석 결과</h2>
              <p>{scan ? `${formatFileName(scan.fileName)} · ${modeLabel(scan.mode)}` : '아직 분석된 문서가 없습니다.'}</p>
            </div>
          </div>

          <div className="metrics">
            <Metric label="검토 필요" value={scan?.summary?.needsFix ?? activeCount} helper="사용자가 확인한 뒤 바꿔야 하는 항목" />
            <Metric label="자동 처리" value={scan?.summary?.autoMasked ?? 0} helper="안전 사본에서 바로 가릴 수 있는 항목" />
            <Metric label="문제 없음" value={scan?.summary?.passed ?? 0} helper="민감정보로 판단되지 않은 항목" />
            <Metric label="반영 완료" value={resolvedCount} helper="수정 버튼으로 처리 완료한 항목" />
          </div>

          <article className="document-preview">{renderMarkedText(scan?.extractedText, findings)}</article>
        </section>

        <aside className="panel fix-panel">
          <div className="section-title">
            <span>4</span>
            <div>
              <h2>수정 반영</h2>
              <p>서버의 `PATCH /findings/{'{findingId}'}`로 반영합니다.</p>
            </div>
          </div>

          {!findings.length && <p className="empty">탐지된 항목이 여기에 표시됩니다.</p>}

          <div className="finding-list">
            {findings.map((finding) => (
              <button
                className={selectedFinding?.findingId === finding.findingId ? 'finding selected' : 'finding'}
                key={finding.findingId}
                type="button"
                onClick={() => setSelectedFindingId(finding.findingId)}
              >
                <span>{finding.label}</span>
                <strong>{finding.originalText}</strong>
                <small>{finding.resolved ? '반영 완료' : severityLabel(finding.severity)}</small>
              </button>
            ))}
          </div>

          {selectedFinding && (
            <div className="decision-box">
              <span className="status ok">{selectedFinding.action}</span>
              <h3>{selectedFinding.suggestion || '검토 후 직접 처리'}</h3>
              <p>{selectedFinding.reason}</p>
              <div className="button-row">
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy === selectedFinding.findingId}
                  onClick={() => handleResolve(selectedFinding)}
                >
                  추천값 반영
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={busy === selectedFinding.findingId}
                  onClick={() => handleResolve(selectedFinding, '')}
                >
                  삭제 처리
                </button>
              </div>
            </div>
          )}

          <div className="download-box">
            <label>
              저장 형식
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                {safeFormats.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary-button" type="button" disabled={!scan || busy === 'download'} onClick={handleDownload}>
              안전 사본 다운로드
            </button>
          </div>
        </aside>
      </section>
    </main>
  )
}

function Metric({ label, value, helper }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  )
}

function modeLabel(mode) {
  return mode === 'blind_hiring' ? '블라인드 채용' : '개인정보 보호'
}

function formatFileName(fileName) {
  if (!fileName) return '파일명 없음'

  const normalized = repairMojibake(fileName)
  return [...normalized]
    .filter((char) => {
      const code = char.charCodeAt(0)
      return code > 31 && code !== 127
    })
    .join('')
    .trim() || '파일명 없음'
}

function repairMojibake(value) {
  if (!/[ÃÂìíêëð]/.test(value)) return value

  try {
    const bytes = Uint8Array.from(value, (char) => char.charCodeAt(0) & 0xff)
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return value
  }
}

function severityLabel(severity) {
  if (severity === 'high') return '높음'
  if (severity === 'medium') return '중간'
  return '낮음'
}

function getDefaultReplacement(finding) {
  if (!finding) return ''
  if (finding.action === 'delete') return ''
  if (typeof finding.suggestion === 'string' && finding.suggestion.trim()) return finding.suggestion
  if (finding.action === 'mask') return '[마스킹]'
  return finding.originalText
}

function renderMarkedText(text, findings) {
  if (!text) return <p className="empty">분석된 텍스트가 여기에 표시됩니다.</p>

  const validFindings = [...findings]
    .filter((finding) => Number.isInteger(finding.startOffset) && Number.isInteger(finding.endOffset))
    .filter((finding) => finding.startOffset >= 0 && finding.endOffset > finding.startOffset)
    .sort((a, b) => a.startOffset - b.startOffset)

  if (!validFindings.length) return <p>{text}</p>

  const nodes = []
  let cursor = 0

  validFindings.forEach((finding) => {
    if (finding.startOffset < cursor) return
    if (cursor < finding.startOffset) nodes.push(text.slice(cursor, finding.startOffset))
    nodes.push(
      <mark key={finding.findingId} title={finding.reason}>
        {finding.resolved ? getDefaultReplacement(finding) : text.slice(finding.startOffset, finding.endOffset)}
      </mark>,
    )
    cursor = finding.endOffset
  })

  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <p>{nodes}</p>
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export default App
