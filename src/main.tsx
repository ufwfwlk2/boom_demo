import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ContentAuditPromptDebugPage from './pages/ContentAuditPromptDebugPage.tsx'

const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
const Page = pathname === '/preview-operations' ? App : ContentAuditPromptDebugPage

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
