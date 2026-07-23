import { useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ??
  '/api/v1'

const MAX_UPLOAD_SIZE = 20 * 1024 * 1024
const ALLOWED_FILE_EXTENSIONS = ['pdf', 'docx', 'txt']
const SESSION_ERROR_CODES = ['SCAN_NOT_FOUND', 'SCAN_EXPIRED']
const SCAN_PAGE_SIZE = 4
const FIX_PAGE_SIZE = 5

const steps = [
  { id: 'home', label: '홈' },
  { id: 'upload', label: '문서 분석' },
  { id: 'scan', label: '사전 점검' },
  { id: 'fix', label: '수정 가이드' },
  { id: 'save', label: '저장 완료' },
]

const featureCards = [
  ['민감정보 탐지', '전화번호, 이메일, 학번 등 개인정보를 정규식 + NER로 정확히 탐지합니다.'],
  ['위험 표현 탐지', '문맥상 위험한 표현까지 AI가 탐지하여 경고합니다.'],
  ['안전한 처리', '원문 미보관, 처리 후 자동 삭제. 데이터는 서버에 남지 않습니다.'],
]

function getErrorMessage(payload, fallback) {
  return payload?.error?.message || fallback
}

function validateUploadFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''

  if (!ALLOWED_FILE_EXTENSIONS.includes(extension)) {
    return '지원하지 않는 파일 형식입니다. PDF, DOCX, TXT 파일을 업로드해 주세요.'
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return '파일 용량이 20MB를 초과했습니다.'
  }

  return ''
}

function getDownloadFilename(response, fallback) {
  const disposition = response.headers.get('Content-Disposition')
  const encodedMatch = disposition?.match(/filename\*=UTF-8''([^;]+)/i)
  const plainMatch = disposition?.match(/filename="?([^";]+)"?/i)

  if (encodedMatch?.[1]) return decodeURIComponent(encodedMatch[1])
  if (plainMatch?.[1]) return plainMatch[1]
  return fallback
}

function modeLabel(mode) {
  return mode === 'blind_hiring' ? '블라인드 채용' : '개인정보 보안'
}

function applyLocalReplacement(finding) {
  if (finding.resolved && typeof finding.replacementText === 'string') {
    return finding.replacementText
  }
  return finding.originalText
}

function getSuggestionText(finding) {
  if (!finding) return ''
  if (typeof finding.suggestion === 'string' && finding.suggestion.trim()) return finding.suggestion
  if (finding.action === 'delete') return ''
  if (finding.action === 'review') return finding.originalText
  return finding.label || '민감정보'
}

function getSuggestedActionText(finding) {
  if (!finding) return ''
  if (typeof finding.suggestion === 'string' && finding.suggestion.trim()) return finding.suggestion
  if (finding.action === 'delete') return '삭제 권장'
  if (finding.action === 'review') return '문맥을 확인한 뒤 직접 수정해 주세요.'
  return `${finding.label || '민감 문구'} 마스킹`
}

function renderMarkedText(text, findings, useReplacement = false) {
  if (!text) return <p className="empty-text">분석된 텍스트가 아직 없습니다.</p>

  const validFindings = [...findings]
    .filter((finding) => Number.isInteger(finding.startOffset) && Number.isInteger(finding.endOffset))
    .filter((finding) => finding.startOffset >= 0 && finding.endOffset > finding.startOffset)
    .sort((a, b) => a.startOffset - b.startOffset)

  if (!validFindings.length) return <p>{text}</p>

  const nodes = []
  let cursor = 0

  validFindings.forEach((finding) => {
    if (finding.startOffset < cursor) return
    if (cursor < finding.startOffset) {
      nodes.push(text.slice(cursor, finding.startOffset))
    }
    nodes.push(
      <mark key={finding.findingId} title={finding.reason}>
        {useReplacement ? applyLocalReplacement(finding) : text.slice(finding.startOffset, finding.endOffset)}
      </mark>,
    )
    cursor = finding.endOffset
  })

  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <p>{nodes}</p>
}

function paginateItems(items, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const safePage = Math.min(Math.max(page, 1), totalPages)
  const start = (safePage - 1) * pageSize

  return {
    currentPage: safePage,
    pageItems: items.slice(start, start + pageSize),
    totalPages,
  }
}

function getVisiblePages(currentPage, totalPages) {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1)

  const pages = new Set([1, totalPages, currentPage])
  if (currentPage > 2) pages.add(currentPage - 1)
  if (currentPage < totalPages - 1) pages.add(currentPage + 1)

  return [...pages].sort((a, b) => a - b)
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()

  window.setTimeout(() => {
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, 0)
}

function App() {
  const [activeStep, setActiveStep] = useState('home')
  const [scanMode, setScanMode] = useState('privacy')
  const [agreed, setAgreed] = useState(true)
  const [scanData, setScanData] = useState(null)
  const [findings, setFindings] = useState([])
  const [selectedFindingId, setSelectedFindingId] = useState(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [safeFormat, setSafeFormat] = useState('pdf')

  const selectedIssue = useMemo(
    () => findings.find((finding) => finding.findingId === selectedFindingId) ?? findings[0] ?? null,
    [findings, selectedFindingId],
  )

  const hasScanSession = Boolean(scanData?.scanId)

  function resetScanSession(message = '점검 세션이 만료되었습니다. 문서를 다시 분석해 주세요.') {
    setScanData(null)
    setFindings([])
    setSelectedFindingId(null)
    setActiveStep('upload')
    setErrorMessage(message)
  }

  function handleSessionError(payload, fallback) {
    const message = getErrorMessage(payload, fallback)

    if (SESSION_ERROR_CODES.includes(payload?.error?.code)) {
      resetScanSession(message || '점검 세션이 만료되었습니다. 문서를 다시 분석해 주세요.')
      return true
    }

    return false
  }

  function applyFindingUpdate(findingId, replacementText, action, resolved = true) {
    setFindings((items) =>
      items.map((item) =>
        item.findingId === findingId
          ? {
              ...item,
              action,
              replacementText,
              resolved,
            }
          : item,
      ),
    )
  }

  function moveToStep(stepId) {
    if ((stepId === 'fix' || stepId === 'save') && !hasScanSession) {
      resetScanSession('문서를 먼저 분석한 뒤 수정하거나 저장할 수 있습니다.')
      return
    }

    setActiveStep(stepId)
  }

  async function handleAnalyze(file) {
    if (!file) return
    if (!agreed) {
      setErrorMessage('민감정보 사전 점검 및 안전본 생성에 동의해 주세요.')
      return
    }

    const fileError = validateUploadFile(file)
    if (fileError) {
      setErrorMessage(fileError)
      return
    }

    setIsAnalyzing(true)
    setErrorMessage('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mode', scanMode)
      formData.append('consent', String(agreed))

      const response = await fetch(`${API_BASE_URL}/scans`, {
        method: 'POST',
        body: formData,
      })
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        throw new Error(getErrorMessage(payload, '문서 분석에 실패했습니다.'))
      }

      setScanData(payload.data)
      setFindings(payload.data.findings ?? [])
      setSelectedFindingId(payload.data.findings?.[0]?.findingId ?? null)
      setActiveStep('scan')
    } catch (error) {
      setErrorMessage(error.message || '문서 분석에 실패했습니다.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  async function updateFinding(finding, replacementText = getSuggestionText(finding), actionOverride = finding?.action) {
    if (!finding) return
    if (!scanData?.scanId) {
      resetScanSession('문서를 먼저 분석한 뒤 수정할 수 있습니다.')
      return
    }

    setIsUpdating(true)
    setErrorMessage('')
    applyFindingUpdate(finding.findingId, replacementText, actionOverride)

    try {
      const response = await fetch(
        `${API_BASE_URL}/scans/${scanData.scanId}/findings/${finding.findingId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: actionOverride,
            replacementText,
            resolved: true,
          }),
        },
      )
      const payload = await response.json()

      if (!response.ok || !payload.success) {
        if (SESSION_ERROR_CODES.includes(payload?.error?.code)) return
        throw new Error(getErrorMessage(payload, '수정 반영에 실패했습니다.'))
      }

      applyFindingUpdate(
        finding.findingId,
        payload.data.replacementText ?? replacementText,
        actionOverride,
        payload.data.resolved ?? true,
      )
    } catch (error) {
      setErrorMessage(error.message || '수정 반영에 실패했습니다.')
    } finally {
      setIsUpdating(false)
    }
  }

  async function downloadSafeCopy() {
    if (!scanData?.scanId) {
      resetScanSession('문서를 먼저 분석한 뒤 안전본을 저장할 수 있습니다.')
      return
    }

    setIsSaving(true)
    setErrorMessage('')

    try {
      const response = await fetch(`${API_BASE_URL}/scans/${scanData.scanId}/safe-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: safeFormat }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        if (handleSessionError(payload, '안전 사본 생성에 실패했습니다.')) return
        throw new Error(getErrorMessage(payload, '안전 사본 생성에 실패했습니다.'))
      }

      const blob = await response.blob()
      downloadBlob(blob, getDownloadFilename(response, `maskit-safe-copy.${safeFormat}`))
    } catch (error) {
      setErrorMessage(error.message || '안전 사본 생성에 실패했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteScan() {
    if (!scanData?.scanId) {
      setScanData(null)
      setFindings([])
      setSelectedFindingId(null)
      setActiveStep('upload')
      return
    }

    try {
      const response = await fetch(`${API_BASE_URL}/scans/${scanData.scanId}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => null)

      if (!response.ok || payload?.success === false) {
        if (handleSessionError(payload, '작업 삭제에 실패했습니다.')) return
        throw new Error(getErrorMessage(payload, '작업 삭제에 실패했습니다.'))
      }

      setScanData(null)
      setFindings([])
      setSelectedFindingId(null)
      setActiveStep('upload')
    } catch (error) {
      setErrorMessage(error.message || '작업 삭제에 실패했습니다.')
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="문서 점검 절차">
        <div className="nav-inner">
          <button className="brand" type="button" onClick={() => moveToStep('home')}>
            maskit
          </button>
          <nav className="nav-list">
            {steps.map((step) => {
              const needsScan = step.id === 'fix' || step.id === 'save'
              const disabled = needsScan && !hasScanSession

              return (
                <button
                  key={step.id}
                  className={activeStep === step.id ? 'nav-item active' : 'nav-item'}
                  type="button"
                  disabled={disabled}
                  onClick={() => moveToStep(step.id)}
                  title={disabled ? '문서를 먼저 분석해 주세요.' : step.label}
                >
                  {step.label}
                </button>
              )
            })}
          </nav>
        </div>
      </aside>

      <section className="workspace">
        {activeStep !== 'home' && <Header activeStep={activeStep} />}
        {errorMessage && <div className="message error">{errorMessage}</div>}
        {activeStep === 'home' && <HomeScreen setActiveStep={setActiveStep} />}
        {activeStep === 'upload' && (
          <UploadScreen
            agreed={agreed}
            isAnalyzing={isAnalyzing}
            scanMode={scanMode}
            setAgreed={setAgreed}
            setScanMode={setScanMode}
            onAnalyze={handleAnalyze}
          />
        )}
        {activeStep === 'scan' && (
          <ScanScreen
            findings={findings}
            scanData={scanData}
            summary={scanData?.summary}
            text={scanData?.extractedText ?? ''}
            setActiveStep={setActiveStep}
          />
        )}
        {activeStep === 'fix' && (
          <FixScreen
            findings={findings}
            selectedIssue={selectedIssue}
            setSelectedFindingId={setSelectedFindingId}
            setActiveStep={setActiveStep}
            isUpdating={isUpdating}
            text={scanData?.extractedText ?? ''}
            updateFinding={updateFinding}
          />
        )}
        {activeStep === 'save' && (
          <SaveScreen
            deleteScan={deleteScan}
            downloadSafeCopy={downloadSafeCopy}
            isSaving={isSaving}
            safeFormat={safeFormat}
            setSafeFormat={setSafeFormat}
            scanData={scanData}
          />
        )}
      </section>
    </main>
  )
}

function Header({ activeStep }) {
  const current = steps.find((step) => step.id === activeStep)

  return (
    <header className="topbar">
      <p className="eyebrow">문서 속 개인정보와 위험 표현을 탐지하고 안전하게 마스킹합니다.</p>
      <h1>{current.label}</h1>
    </header>
  )
}

function HomeScreen({ setActiveStep }) {
  return (
    <div className="home-screen">
      <section className="hero-panel">
        <h2>maskit</h2>
        <p>문서 속 개인정보와 위험 표현을 탐지하고, 안전하게 마스킹해주는 서비스입니다.</p>
        <button className="primary-button hero-action" type="button" onClick={() => setActiveStep('upload')}>
          분석 시작하기
        </button>
      </section>

      <section className="feature-grid" aria-label="서비스 특징">
        {featureCards.map(([title, description]) => (
          <article className="feature-card" key={title}>
            <h3>{title}</h3>
            <p>{description}</p>
          </article>
        ))}
      </section>
    </div>
  )
}

function UploadScreen({
  agreed,
  isAnalyzing,
  scanMode,
  setAgreed,
  setScanMode,
  onAnalyze,
}) {
  const fileInputRef = useRef(null)

  return (
    <div className="home-screen">
      <section className="action-grid">
        <div className="dropzone">
          <span className="drop-icon">+</span>
          <h2>점검할 글 불러오기</h2>
          <p>PDF, DOCX, TXT 파일을 올릴 수 있습니다.</p>
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={(event) => {
              onAnalyze(event.target.files?.[0])
              event.target.value = ''
            }}
          />
          <button
            className="primary-button"
            type="button"
            disabled={isAnalyzing}
            onClick={() => fileInputRef.current?.click()}
          >
            {isAnalyzing ? '분석 중...' : '파일 선택'}
          </button>
        </div>

        <div className="panel">
          <PanelTitle title="이번 검사 정보" />
          <div className="form-stack">
            <label>
              글 점검
              <select value={scanMode} onChange={(event) => setScanMode(event.target.value)}>
                <option value="privacy">개인정보 보안</option>
                <option value="blind_hiring">블라인드 채용</option>
              </select>
            </label>
            <label className="checkbox-line">
              <input checked={agreed} onChange={(event) => setAgreed(event.target.checked)} type="checkbox" />
              민감정보 사전 점검 및 안전본 생성에 동의합니다.
            </label>
            <p className="helper-text">
              서버 API: <code>POST /api/v1/scans</code>
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function ScanScreen({ findings, scanData, summary, text, setActiveStep }) {
  const [issuePage, setIssuePage] = useState(1)
  const {
    currentPage: currentIssuePage,
    pageItems: visibleFindings,
    totalPages: issueTotalPages,
  } = paginateItems(findings, issuePage, SCAN_PAGE_SIZE)

  if (!scanData) {
    return (
      <section className="complete-panel">
        <h2>분석된 문서가 없습니다.</h2>
        <p>문서를 업로드하면 백엔드 분석 결과가 이 화면에 표시됩니다.</p>
        <button className="primary-button" type="button" onClick={() => setActiveStep('upload')}>
          문서 분석으로 이동
        </button>
      </section>
    )
  }

  return (
    <div className="screen-grid">
      <section className="wide-panel full-span">
        <PanelTitle title="점검 결과 요약" action={modeLabel(scanData.mode)} />
        <div className="metric-row">
          <Metric label="수정 필요" value={`${summary?.needsFix ?? 0}건`} delta="확인 필요 항목" />
          <Metric label="자동 마스킹" value={`${summary?.autoMasked ?? 0}건`} delta="연락처, 이메일 등" />
          <Metric label="통과 항목" value={`${summary?.passed ?? 0}건`} delta="문제 없음" />
          <Metric label="탐지 항목" value={`${findings.length}건`} delta="전체 탐지된 항목" />
        </div>
      </section>

      <section className="wide-panel">
        <PanelTitle title="발견된 항목" />
        <div className="issue-list paginated-list">
          {visibleFindings.map((issue) => (
            <article className="issue-card" key={issue.findingId}>
              <span>{issue.label}</span>
              <strong>{issue.originalText}</strong>
              <p>{issue.reason}</p>
              <em>{issue.resolved ? '반영 완료' : severityLabel(issue.severity)}</em>
            </article>
          ))}
        </div>
        <Pagination
          currentPage={currentIssuePage}
          totalPages={issueTotalPages}
          onPageChange={setIssuePage}
        />
        <div className="button-row panel-actions">
          <button className="primary-button" type="button" onClick={() => setActiveStep('fix')}>
            수정 가이드 보기
          </button>
          <button className="ghost-button" type="button" onClick={() => setActiveStep('save')}>
            안전본 저장으로 이동
          </button>
        </div>
      </section>

      <section className="wide-panel">
        <PanelTitle title="분석 텍스트 미리보기" />
        <article className="paper small-paper text-preview">{renderMarkedText(text, findings)}</article>
      </section>
    </div>
  )
}

function FixScreen({
  findings,
  isUpdating,
  selectedIssue,
  setActiveStep,
  setSelectedFindingId,
  text,
  updateFinding,
}) {
  const [findingPage, setFindingPage] = useState(1)
  const {
    currentPage: currentFindingPage,
    pageItems: visibleFindings,
    totalPages: findingTotalPages,
  } = paginateItems(findings, findingPage, FIX_PAGE_SIZE)

  function handleFindingPageChange(page) {
    const { pageItems } = paginateItems(findings, page, FIX_PAGE_SIZE)
    setFindingPage(page)

    if (pageItems[0]) {
      setSelectedFindingId(pageItems[0].findingId)
    }
  }

  if (!selectedIssue) {
    return (
      <section className="complete-panel">
        <h2>수정할 항목이 없습니다.</h2>
        <p>문서를 먼저 분석하면 수정 가이드가 표시됩니다.</p>
        <button className="primary-button" type="button" onClick={() => setActiveStep('save')}>
          안전본 저장으로 이동
        </button>
      </section>
    )
  }

  return (
    <div className="review-layout">
      <section className="document-viewer" aria-label="문서 수정 미리보기">
        <div className="viewer-toolbar">
          <button className="ghost-button" type="button" onClick={() => setActiveStep('save')}>
            안전본 저장
          </button>
        </div>
        <article className="paper text-preview">
          <h2>수정본 미리보기</h2>
          {renderMarkedText(text, findings, true)}
          <p className="rewrite">
            추천 조치: {getSuggestedActionText(selectedIssue)}
          </p>
        </article>
      </section>

      <aside className="review-panel">
        <PanelTitle title="수정할 항목" />
        <div className="finding-list paginated-list">
          {visibleFindings.map((issue) => (
            <button
              key={issue.findingId}
              className={selectedIssue.findingId === issue.findingId ? 'finding selected' : 'finding'}
              type="button"
              onClick={() => setSelectedFindingId(issue.findingId)}
            >
              <span>{issue.label}</span>
              <strong>{issue.originalText}</strong>
              <small>{issue.resolved ? '반영 완료' : severityLabel(issue.severity)}</small>
            </button>
          ))}
        </div>
        <Pagination
          currentPage={currentFindingPage}
          totalPages={findingTotalPages}
          onPageChange={handleFindingPageChange}
        />
        <div className="decision-panel">
          <span className="status-pill danger">{selectedIssue.label}</span>
          <h2>{getSuggestedActionText(selectedIssue)}</h2>
          <p>{selectedIssue.reason}</p>
          <ReplacementEditor
            key={selectedIssue.findingId}
            isUpdating={isUpdating}
            selectedIssue={selectedIssue}
            updateFinding={updateFinding}
          />
        </div>
      </aside>
    </div>
  )
}

function ReplacementEditor({ isUpdating, selectedIssue, updateFinding }) {
  const [customText, setCustomText] = useState(selectedIssue.replacementText ?? getSuggestionText(selectedIssue))

  return (
    <>
      <label className="custom-replacement">
        직접 수정 문구
        <textarea
          value={customText}
          onChange={(event) => setCustomText(event.target.value)}
          placeholder="수정본에 반영할 문구를 입력하세요."
          rows={4}
        />
      </label>
      <div className="button-row compact">
        <button
          className="primary-button"
          type="button"
          disabled={isUpdating}
          onClick={() => updateFinding(selectedIssue, customText, 'replace')}
        >
          {isUpdating ? '반영 중...' : '수정 반영'}
        </button>
        <button
          className="ghost-button"
          type="button"
          disabled={isUpdating}
          onClick={() => updateFinding(selectedIssue, '', 'delete')}
        >
          삭제로 반영
        </button>
      </div>
    </>
  )
}

function Pagination({ currentPage, totalPages, onPageChange }) {
  if (totalPages <= 1) return null

  const pages = getVisiblePages(currentPage, totalPages)

  return (
    <div className="pagination" aria-label="목록 페이지">
      <button
        className="page-button"
        type="button"
        disabled={currentPage === 1}
        onClick={() => onPageChange(currentPage - 1)}
      >
        이전
      </button>
      {pages.map((page, index) => {
        const previousPage = pages[index - 1]
        const hasGap = previousPage && page - previousPage > 1

        return (
          <span className="page-group" key={page}>
            {hasGap && <span className="page-ellipsis">...</span>}
            <button
              className={currentPage === page ? 'page-number active' : 'page-number'}
              type="button"
              onClick={() => onPageChange(page)}
            >
              {page}
            </button>
          </span>
        )
      })}
      <button
        className="page-button"
        type="button"
        disabled={currentPage === totalPages}
        onClick={() => onPageChange(currentPage + 1)}
      >
        다음
      </button>
    </div>
  )
}

function SaveScreen({ deleteScan, downloadSafeCopy, isSaving, safeFormat, setSafeFormat, scanData }) {
  return (
    <section className="complete-panel">
      <span className="complete-mark">OK</span>
      <h2>안전본을 내 컴퓨터에 저장할 준비가 끝났습니다.</h2>
      <p>
        마스킹된 안전본은 서버에 별도 파일로 저장하지 않고 즉시 다운로드됩니다.
        저장 후에는 사용자가 원하는 채용 사이트나 이메일에 직접 업로드할 수 있습니다.
      </p>
      <label className="format-picker">
        저장 형식
        <select value={safeFormat} onChange={(event) => setSafeFormat(event.target.value)}>
          <option value="pdf">PDF</option>
          <option value="docx">DOCX</option>
          <option value="txt">TXT</option>
        </select>
      </label>
      <div className="button-row">
        <button className="primary-button" type="button" disabled={isSaving} onClick={downloadSafeCopy}>
          {isSaving ? '저장 중...' : '내 컴퓨터에 저장'}
        </button>
        <button className="ghost-button" type="button" onClick={deleteScan}>
          {scanData ? '작업 삭제' : '문서 분석으로 돌아가기'}
        </button>
      </div>
    </section>
  )
}

function Metric({ label, value, delta }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{delta}</small>
    </article>
  )
}

function PanelTitle({ title, action }) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      {action && <span>{action}</span>}
    </div>
  )
}

function severityLabel(severity) {
  if (severity === 'high') return '높음'
  if (severity === 'medium') return '중간'
  return '낮음'
}

export default App
