import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

document.documentElement.dataset.platform = window.cueport?.platform ?? 'web'

const root = document.getElementById('root')
if (!root) throw new Error('Cueport could not find its renderer root.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
