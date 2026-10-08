import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyInitialTheme } from './lib/theme'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/paper.css'

// Before the first render, so a dark-mode learner never sees a light flash.
applyInitialTheme()

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element in index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
