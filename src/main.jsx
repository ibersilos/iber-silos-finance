import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import IberSilosApp from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <IberSilosApp />
  </StrictMode>,
)
