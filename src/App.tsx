import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Toasts } from './components/Toasts'
import { ErrorState, Skeleton } from './components/ui'
import { useApp } from './state/store'
import { CommandCenter } from './screens/CommandCenter'
import { Analytics } from './screens/Analytics'
import { ProductAnalytics } from './screens/ProductAnalytics'
import { Content } from './screens/Content'
import { WarRoom } from './screens/WarRoom'
import { FreshMonitor } from './screens/FreshMonitor'
import { CampaignDoctor } from './screens/CampaignDoctor'
import { Queue } from './screens/Queue'
import { Ledger } from './screens/Ledger'
import { CreativeIntel } from './screens/CreativeIntel'
import { OrganicIntel } from './screens/OrganicIntel'
import { TrackingHealth } from './screens/TrackingHealth'
import { Copilot } from './screens/Copilot'
import { Settings } from './screens/Settings'
import { NotFound } from './screens/NotFound'

function LoadingSkeleton() {
  return (
    <div className="animate-fade-in">
      <Skeleton className="h-7 w-64 mb-2" />
      <Skeleton className="h-4 w-96 mb-6" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
      <div className="mt-4">
        <Skeleton className="h-64" />
      </div>
    </div>
  )
}

export default function App() {
  const { status, error, init, retry } = useApp()

  useEffect(() => {
    if (status === 'idle') void init()
  }, [status, init])

  return (
    <Shell>
      {status === 'loading' || status === 'idle' ? (
        <LoadingSkeleton />
      ) : status === 'error' ? (
        <ErrorState message={error ?? 'Failed to load the workspace snapshot.'} onRetry={() => void retry()} />
      ) : (
        <Routes>
          <Route path="/" element={<CommandCenter />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/product" element={<ProductAnalytics />} />
          <Route path="/content" element={<Content />} />
          <Route path="/war-room" element={<WarRoom />} />
          <Route path="/war-room/:alertId" element={<WarRoom />} />
          <Route path="/fresh" element={<FreshMonitor />} />
          <Route path="/doctor" element={<CampaignDoctor />} />
          <Route path="/doctor/:campaignId" element={<CampaignDoctor />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/ledger/:decisionId" element={<Ledger />} />
          <Route path="/creative" element={<CreativeIntel />} />
          <Route path="/creative/:creativeId" element={<CreativeIntel />} />
          <Route path="/organic" element={<OrganicIntel />} />
          <Route path="/tracking" element={<TrackingHealth />} />
          <Route path="/tracking/:sourceId" element={<TrackingHealth />} />
          <Route path="/copilot" element={<Copilot />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/:tab" element={<Settings />} />
          <Route path="/index.html" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      )}
      <Toasts />
    </Shell>
  )
}
