import os
from fastapi import Request, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from clerk_backend_api import Clerk
from clerk_backend_api.security.types import AuthenticateRequestOptions

clerk_secret = os.getenv("CLERK_SECRET_KEY", "")
if not clerk_secret:
    print("CLERK_SECRET_KEY is missing! Auth will fail.")

clerk = Clerk(bearer_auth=clerk_secret)
security = HTTPBearer()

class ClerkRequest:
    """Wrapper to make FastAPI Request compatible with Clerk's expectation of Requestish."""
    def __init__(self, request: Request):
        self.headers = dict(request.headers)
        self.url = str(request.url)

async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Security(security)) -> str:
    """
    FastAPI dependency that validates the Clerk JWT token.
    Returns the user's Clerk ID string.
    """
    try:
        req_wrapper = ClerkRequest(request)
        request_state = clerk.authenticate_request(req_wrapper, AuthenticateRequestOptions())
        
        if not request_state.is_signed_in:
            raise HTTPException(status_code=401, detail="Unauthenticated or token expired")
            
        payload = request_state.payload
        clerk_id = payload.get("sub")
        if not clerk_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")
            
        return clerk_id
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Auth] Error verifying token: {e}")
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")
