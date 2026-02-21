import React from 'react'
import ReactDOM from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import ClaimsProcessor from './ClaimsProcessor.jsx'

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
console.log("Clerk key:", clerkPubKey)
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={clerkPubKey}>
      <ClaimsProcessor />
    </ClerkProvider>
  </React.StrictMode>,
)