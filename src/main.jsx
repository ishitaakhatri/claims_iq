import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import ClaimsProcessor from './ClaimsProcessor.jsx'

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!clerkPubKey) {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <div style={{
      background: '#030712', color: '#f87171', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'sans-serif', padding: 20, textAlign: 'center'
    }}>
      <div>
        <h1 style={{ fontSize: 24, marginBottom: 12 }}>Missing Clerk Key</h1>
        <p>Please add <code>VITE_CLERK_PUBLISHABLE_KEY</code> to your <code>.env</code> file.</p>
      </div>
    </div>
  )
} else {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ClerkProvider publishableKey={clerkPubKey}>
        <ClaimsProcessor />
      </ClerkProvider>
    </React.StrictMode>,
  )
}