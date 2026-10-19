import './styles/tokens.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/annotations.css'
import './styles/pitch.css'
import './styles/episodes.css'
import './styles/settings.css'
import './styles/project.css'
import './styles/export.css'
import './styles/stats.css'
import './styles/start.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
