import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '../../../../src/renderer/src/styles.css'
import './web.css'

document.documentElement.dataset.platform = 'web'

const root = document.getElementById('root')
if (!root) throw new Error('Cueport could not find its web root.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
