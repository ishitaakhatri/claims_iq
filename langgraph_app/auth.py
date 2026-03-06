import os
from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from clerk_backend_api import Clerk
from clerk_backend_api.security.types import AuthenticateRequestOptions
from .services.database import get_user_by_clerk_id

clerk_secret = os.getenv("CLERK_SECRET_KEY", "")
if not clerk_secret:
    print("CLERK_SECRET_KEY is missing! Auth will fail.")

clerk = Clerk(bearer_auth=clerk_secret)
security = HTTPBearer()

class CaseInsensitiveDict(dict):
    """A dict subclass where key lookups are case-insensitive."""
    def __getitem__(self, key):
        return super().__getitem__(key.lower())
    def get(self, key, default=None):
        return super().get(key.lower(), default)
    def __contains__(self, key):
        return super().__contains__(key.lower())

class ClerkRequest:
    """Wrapper to make FastAPI Request compatible with Clerk's expectation of Requestish."""
    def __init__(self, request: Request):
        # ASGI/Starlette lowercases all header names, but Clerk SDK
        # looks for 'Authorization' with capital A — use case-insensitive dict.
        self.headers = CaseInsensitiveDict(request.headers)
        self.url = str(request.url)

def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Security(security)) -> str:
    """
    FastAPI dependency that validates the Clerk JWT token.
    Returns the user's Clerk ID string.
    """
    try:
        req_wrapper = ClerkRequest(request)
        request_state = clerk.authenticate_request(
            req_wrapper,
            AuthenticateRequestOptions(
                authorized_parties=[
                    "http://localhost:5173",
                    "http://localhost:8000",
                ]
            )
        )
        
        if not request_state.is_signed_in:
            print(f"[Auth] Token not signed in. Reason: {getattr(request_state, 'reason', 'unknown')}")
            raise HTTPException(status_code=401, detail="Unauthenticated or token expired")
            
        payload = request_state.payload
        clerk_id = payload.get("sub")
        if not clerk_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")
            
        user_info = get_user_by_clerk_id(clerk_id)
        if not user_info or not user_info.get("id"):
            raise HTTPException(status_code=401, detail="Could not resolve user identity in database")
            
        return user_info
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Auth] Error verifying token: {e}")
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
